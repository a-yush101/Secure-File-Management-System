from flask import Flask, request, jsonify, send_file, session
from werkzeug.utils import secure_filename
from cryptography.fernet import Fernet
import json, time, os
from datetime import datetime

app = Flask(__name__, static_folder="public", static_url_path="")
app.secret_key = "supersecretkey"

# ==========================================================
# JSON STORAGE HELPERS
# ==========================================================

def load_json(path):
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        try:
            return json.load(f)
        except:
            return {}

def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=4)

# ==========================================================
# ENCRYPTION SETUP
# ==========================================================

if not os.path.exists("secret.key"):
    with open("secret.key", "wb") as f:
        f.write(Fernet.generate_key())

with open("secret.key", "rb") as f:
    cipher = Fernet(f.read())


# ==========================================================
# LOGGING
# ==========================================================

def log_event(event, detail):
    logs = load_json("logs.json")
    logs[str(time.time())] = {
        "event": event,
        "detail": detail,
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "user": session.get("user", "unknown")
    }
    save_json("logs.json", logs)


# ==========================================================
# USER AUTH
# ==========================================================

@app.post("/api/register")
def register():
    data = request.json
    u = data.get("username")
    p = data.get("password")

    users = load_json("users.json")

    if u in users:
        return jsonify({"error": "User already exists"}), 400

    users[u] = {"password": p}
    save_json("users.json", users)

    log_event("REGISTER", f"User '{u}' registered")

    return jsonify({"success": True})


@app.post("/api/login")
def login():
    data = request.json
    u = data.get("username")
    p = data.get("password")

    users = load_json("users.json")

    if u not in users or users[u]["password"] != p:
        return jsonify({"error": "Invalid credentials"}), 400

    session["user"] = u

    log_event("LOGIN", f"User '{u}' logged in")
    return jsonify({"success": True})


@app.post("/api/logout")
def logout():
    user = session.get("user", "")
    log_event("LOGOUT", f"User '{user}' logged out")
    session.clear()
    return jsonify({"success": True})


@app.get("/api/me")
def me():
    if "user" not in session:
        return jsonify({"logged_in": False})
    return jsonify({"logged_in": True, "user": session["user"]})


# ==========================================================
# FILE METADATA HELPERS
# ==========================================================

def add_file_metadata(user, filename):
    files = load_json("files.json")
    file_id = str(time.time())

    files[file_id] = {
        "id": file_id,
        "name": filename,
        "owner": user,
        "size": os.path.getsize(f"data/{filename}"),
        "uploaded": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "modified": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "permissions": []
    }

    save_json("files.json", files)
    return file_id


def get_file_permissions(file_meta, user):
    if user == file_meta["owner"]:
        return "write"

    for p in file_meta["permissions"]:
        if p["user"] == user:
            return p["mode"]

    return None  # no access


# ==========================================================
# FILE UPLOAD (WITH THREAT PROTECTION)
# ==========================================================

@app.post("/api/upload")
def upload_file():
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 403

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    user = session["user"]
    f = request.files["file"]
    filename = secure_filename(f.filename)

    # BLOCKED EXTENSIONS
    blocked_ext = [".exe", ".dll", ".bat", ".sh"]
    if any(filename.lower().endswith(ext) for ext in blocked_ext):
        log_event("UPLOAD_BLOCKED", f"Forbidden extension: {filename}")
        return jsonify({"error": "File type not allowed"}), 400

    data = f.read()

    # SIGNATURE CHECK
    signatures = [b"virus", b"trojan", b"malware"]
    if any(sig in data.lower() for sig in signatures):
        log_event("UPLOAD_BLOCKED", f"Malware detected in {filename}")
        return jsonify({"error": "Malware detected"}), 400

    # PASS — SAVE ENCRYPTED FILE
    encrypted = cipher.encrypt(data)
    with open(f"data/{filename}", "wb") as out:
        out.write(encrypted)

    file_id = add_file_metadata(user, filename)

    log_event("UPLOAD_SAFE", f"{filename} uploaded successfully")

    return jsonify({"success": True, "id": file_id})


# ==========================================================
# GET ALL FILES OF USER
# ==========================================================

@app.get("/api/files")
def list_files():
    if "user" not in session:
        return jsonify([])

    user = session["user"]
    files = load_json("files.json")

    result = []
    for f in files.values():
        if f["owner"] == user or any(p["user"] == user for p in f["permissions"]):
            result.append(f)

    return jsonify(result)


# ==========================================================
# READ FILE (DECRYPT)
# ==========================================================

@app.get("/api/read/<id>")
def read_file(id):
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 403

    user = session["user"]
    files = load_json("files.json")

    if id not in files:
        return jsonify({"error": "File not found"}), 404

    fmeta = files[id]
    perm = get_file_permissions(fmeta, user)

    if perm not in ["read", "write"]:
        return jsonify({"error": "No permission"}), 403

    path = f"data/{fmeta['name']}"
    with open(path, "rb") as file:
        decrypted = cipher.decrypt(file.read()).decode()

    return jsonify({"content": decrypted})


# ==========================================================
# WRITE (EDIT FILE)
# ==========================================================

@app.post("/api/write/<id>")
def write_file(id):
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 403

    user = session["user"]
    files = load_json("files.json")

    if id not in files:
        return jsonify({"error": "File not found"}), 404

    fmeta = files[id]
    perm = get_file_permissions(fmeta, user)

    if perm != "write":
        return jsonify({"error": "No write permission"}), 403

    data = request.json.get("text", "").encode()

    encrypted = cipher.encrypt(data)
    with open(f"data/{fmeta['name']}", "wb") as file:
        file.write(encrypted)

    fmeta["modified"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    files[id] = fmeta
    save_json("files.json", files)

    log_event("EDIT", f"{user} edited {fmeta['name']}")

    return jsonify({"success": True})

@app.post("/api/delete/<id>")
def delete_file(id):
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 403

    files = load_json("files.json")
    if id not in files:
        return jsonify({"error": "File not found"}), 404

    user = session["user"]
    f = files[id]

    # Only owner can delete
    if f["owner"] != user:
        return jsonify({"error": "Only owner can delete"}), 403

    # Delete file from disk
    path = "data/" + f["name"]
    if os.path.exists(path):
        os.remove(path)

    # Remove metadata
    del files[id]
    save_json("files.json", files)

    # Log deletion
    log_event("DELETE", f"{user} deleted file {f['name']}")

    return jsonify({"success": True})


# ==========================================================
# DOWNLOAD (DECRYPT)
# ==========================================================

@app.get("/api/download/<id>")
def download(id):
    if "user" not in session:
        return "Not logged in", 403

    files = load_json("files.json")
    if id not in files:
        return "File not found", 404

    fmeta = files[id]
    filepath = f"data/{fmeta['name']}"

    # TEMPORARY DECRYPT OUTPUT
    temp = "temp_download.bin"

    with open(filepath, "rb") as encrypted:
        data = cipher.decrypt(encrypted.read())

    with open(temp, "wb") as out:
        out.write(data)

    return send_file(temp, as_attachment=True, download_name=fmeta["name"])


# ==========================================================
# SHARE FILE
# ==========================================================

@app.post("/api/share")
def share():
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 403

    data = request.json
    file_id = data.get("id")
    share_user = data.get("user")
    mode = data.get("mode")

    files = load_json("files.json")

    if file_id not in files:
        return jsonify({"error": "File not found"}), 404

    fmeta = files[file_id]

    if fmeta["owner"] != session["user"]:
        return jsonify({"error": "Only owner can share"}), 403

    fmeta["permissions"].append({"user": share_user, "mode": mode})
    files[file_id] = fmeta

    save_json("files.json", files)

    log_event("SHARE", f"{session['user']} shared {fmeta['name']} with {share_user} ({mode})")

    return jsonify({"success": True})


# ==========================================================
# FILE METADATA
# ==========================================================

@app.get("/api/meta/<id>")
def meta(id):
    files = load_json("files.json")

    if id not in files:
        return jsonify({"error": "Not found"}), 404

    return jsonify(files[id])


# ==========================================================
# ADMIN LOGS
# ==========================================================
@app.get("/api/logs")
def logs():
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 403

    logs = load_json("logs.json")
    return jsonify(logs)


# ==========================================================
# STATIC PAGES
# ==========================================================

@app.get("/")
def index():
    return app.send_static_file("index.html")


# ==========================================================
# RUN SERVER
# ==========================================================

if __name__ == "__main__":
    app.run(debug=True)
