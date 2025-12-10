/* THEME */
function applyTheme(){ let t=localStorage.getItem("theme")||"light"; document.body.className=t }
function toggleTheme(){ let next = document.body.className==="light"?"dark":"light"; localStorage.setItem("theme", next); applyTheme() }
document.addEventListener("DOMContentLoaded", applyTheme)

/* API helper */
async function api(path, opts={}) {
  opts.credentials = "same-origin"; 
  opts.headers = opts.headers || {};

  if (opts.json) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.json);
  }

  const res = await fetch("/api" + path, opts);
  const txt = await res.text();

  try { return { ok: res.ok, json: JSON.parse(txt) }; }
  catch(e){ return { ok: res.ok, text: txt }; }
}

/* AUTH (register/login/logout) */
async function register() {
  const u=document.getElementById("username").value.trim(),
        p=document.getElementById("password").value,
        msg=document.getElementById("reg-msg");

  msg.innerText="";
  if(!u||!p){ msg.innerText="Fill all fields"; return }

  const r = await api("/register",{method:"POST", json:{username:u,password:p}});
  if(!r.ok) msg.innerText = r.json?.error || "Error";
  else window.location="/login.html";
}

async function login(){
  const u=document.getElementById("login-user").value.trim(),
        p=document.getElementById("login-pass").value,
        msg=document.getElementById("login-msg");

  msg.innerText="";
  if(!u||!p){ msg.innerText="Fill all fields"; return }

  const r = await api("/login",{method:"POST", json:{username:u,password:p}});
  if(!r.ok) msg.innerText = r.json?.error || "Invalid";
  else window.location="/dashboard.html";
}

async function logout(){
  await api("/logout",{method:"POST"});
  window.location="/index.html";
}

/* DASHBOARD */
async function loadDashboard(){
  const me = await api("/me");
  if(!me.ok || !me.json.logged_in){
    window.location="/login.html"; 
    return;
  }

  document.getElementById("who").innerText = "Signed in: " + me.json.user;

  const res = await api("/files");
  const tbody = document.getElementById("files-body");
  tbody.innerHTML = "";

  if(res.ok){
    for(const f of res.json){
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${escapeHtml(f.name)}</td>
        <td>${f.size}</td>
        <td>${new Date(f.modified).toLocaleString()}</td>
        
        <td class="actions">
          <a href="/fileview.html?id=${f.id}">Open</a> |
          <a href="/api/download/${f.id}">Download</a> |
          <a href="#" onclick="deleteFile('${f.id}')">Delete</a>
        </td>
      `;

      tbody.appendChild(tr);
    }
  }

  // Admin logs
  if(me.json.user === "admin"){
    const logsBox = document.getElementById("logs"),
          logsRes = await api("/logs");

    if(logsRes.ok){
      let html = "";
      for(const k in logsRes.json){
        const e = logsRes.json[k];
        html += `<div><b>${e.time}</b> — ${escapeHtml(e.user||"")}: ${escapeHtml(e.event)} ${escapeHtml(e.detail||"")}</div>`;
      }
      logsBox.innerHTML = html;
      document.getElementById("admin-logs").style.display="block";
    }
  }

  // Show filename next to upload button
  const fi = document.getElementById("file-input");
  if(fi){
    fi.onchange = () => {
      document.getElementById("file-name-display").innerText =
        fi.files.length ? fi.files[0].name : "No file selected";
    };
  }
}

async function uploadFile(){
  const inp=document.getElementById("file-input"),
        msg=document.getElementById("upload-msg");

  msg.innerText="";
  if(!inp.files.length){ msg.innerText="Select file"; return }

  const fd=new FormData(); 
  fd.append("file", inp.files[0]);

  const r = await fetch("/api/upload",{method:"POST", body:fd, credentials:"same-origin"});
  const j = await r.json();

  if(!r.ok){ msg.innerText = j.error || j.reason || "Upload failed"; return }

  msg.innerText = "Uploaded";
  setTimeout(loadDashboard,600);
}

/* FILE VIEW / PREVIEW / META */
function getParam(name){ return new URLSearchParams(window.location.search).get(name) }

async function loadFileView(){
  const id = getParam("id");
  if(!id){ window.location="/dashboard.html"; return }
  window._fid = id;

  const meta = await api("/meta/"+id);
  if(!meta.ok){ alert("Cannot load file metadata"); window.location="/dashboard.html"; return }

  const f = meta.json;

  document.getElementById("fname").innerText = f.name;
  document.getElementById("fmeta").innerText =
    `Owner: ${f.owner} • Size: ${f.size} bytes • Modified: ${new Date(f.modified).toLocaleString()}`;
  document.getElementById("download-btn").onclick = () => window.location = "/api/download/"+id;

  // Metadata panel
  document.getElementById("m-name").innerText = f.name;
  document.getElementById("m-owner").innerText = f.owner;
  document.getElementById("m-size").innerText = `${f.size} bytes`;
  document.getElementById("m-uploaded").innerText = new Date(f.uploaded).toLocaleString();
  document.getElementById("m-modified").innerText = new Date(f.modified).toLocaleString();

  // Permissions table
  const permBody = document.querySelector("#perm-table tbody");
  permBody.innerHTML = "";
  for(const p of f.permissions || []){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(p.user)}</td><td>${escapeHtml(p.mode)}</td>`;
    permBody.appendChild(tr);
  }
}

/* Preview functions */
async function readFile(){
  const id = window._fid;
  const r = await api("/read/"+id);

  const area = document.getElementById("preview-area"),
        box = document.getElementById("preview");

  if(!r.ok){
    area.style.display="block";
    box.innerText = r.json?.error || "Cannot preview";
    return;
  }

  area.style.display = "block";
  box.innerText = r.json.content;

  area.scrollIntoView({behavior:"smooth", block:"center"});
}

function closePreview(){
  document.getElementById("preview-area").style.display="none";
}

function enableEdit(){
  document.getElementById("editor-area").style.display="block";
  document.getElementById("editor").value =
    document.getElementById("preview").innerText || "";
}

async function saveEdit(){
  const id = window._fid,
        text = document.getElementById("editor").value;

  const r = await api("/write/"+id, { method:"POST", json:{ text }});

  if(!r.ok) alert(r.json?.error || "Save failed");
  else {
    alert("Saved");
    document.getElementById("editor-area").style.display="none";
  }
}

function cancelEdit(){
  document.getElementById("editor-area").style.display="none";
}

/* SHARE */
async function shareFile(){
  const id = window._fid,
        user = document.getElementById("share-user").value.trim(),
        mode = document.getElementById("share-mode").value,
        msg=document.getElementById("share-msg");

  msg.innerText="";
  if(!user){ msg.innerText="Enter username"; return }

  const r = await api("/share", { method:"POST", json:{ id, user, mode }});

  if(!r.ok) msg.innerText = r.json?.error || "Share failed";
  else msg.innerText = "Shared successfully";
}

/* DELETE (FIXED) */
async function deleteFile(id){
  if(!confirm("Delete this file?")) return;

  const r = await api("/delete/" + id, { method:"POST" });

  if(r.ok){
    alert("File deleted");
    loadDashboard();
  } else {
    alert(r.json?.error || "Could not delete");
  }
}

/* small helpers */
function escapeHtml(s){
  return (s||"").toString()
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

/* ============================
   THREAT DASHBOARD
=============================*/

async function loadThreatPage() {

  const me = await api("/me");
  if (!me.ok || !me.json.logged_in) {
      window.location = "/login.html";
      return;
  }

  // FIXED: use "/logs" (NOT "/api/logs")
  const logsRes = await api("/logs");

  if (!logsRes.ok) {
      document.getElementById("threat-summary").innerHTML =
          "<div class='notice'>Threat logs only visible to admin.</div>";
      document.getElementById("blocked-events").innerText = "Not authorized.";
      return;
  }

  const logs = logsRes.json;
  let safe = 0, blocked = 0, blockedList = "";

  Object.keys(logs).forEach(k => {
    const e = logs[k];
    if (e.event === "UPLOAD_SAFE") safe++;
    if (e.event === "UPLOAD_BLOCKED") {
      blocked++;
      blockedList += `
        <div style="margin-bottom:6px;">
          ❌ <b>${e.time}</b> — ${e.detail}
        </div>`;
    }
  });

  document.getElementById("threat-summary").innerHTML = `
    <div class="meta-grid" style="grid-template-columns:repeat(3,1fr);text-align:center;">
      <div class="meta-box">
        <h3>${safe + blocked}</h3>
        <div class="label">Total Uploads</div>
      </div>

      <div class="meta-box">
        <h3>${safe}</h3>
        <div class="label">Safe</div>
      </div>

      <div class="meta-box">
        <h3>${blocked}</h3>
        <div class="label">Blocked</div>
      </div>
    </div>`;

  document.getElementById("blocked-events").innerHTML =
      blocked ? blockedList : "No blocked uploads detected.";

  const ctx = document.getElementById("threatChart");

  new Chart(ctx, {
    type: "pie",
    data: {
      labels: ["Safe", "Blocked"],
      datasets: [{
        data: [safe, blocked],
        backgroundColor: ["#22c55e", "#ef4444"],
        borderWidth: 1
      }]
    },
    options: {
      plugins: {
        legend: {
          labels: {
            color: document.documentElement.className === "dark"
              ? "#e2e8f0" : "#1e293b"
          }
        }
      }
    }
  });
}

/* ROUTER INIT */
document.addEventListener("DOMContentLoaded", ()=>{
  const p = window.location.pathname;

  if(p.endsWith("dashboard.html")) loadDashboard();
  if(p.endsWith("fileview.html")) loadFileView();
  if(p.endsWith("threats.html")) loadThreatPage();
});
