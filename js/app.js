const DB_KEY = "lmaDogTrainer.v5";
const LEGACY_KEYS = ["lmaDogTrainer.v4", "lmaDogTrainer.v3", "lmaDogTrainer.v2", "lmaDogTrainer.v1"];
const MEDIA_ROOT = "lma-dog-trainer";
const IDB_NAME = "lmaDogTrainerMedia";
const IDB_STORE = "media";

const state = loadState();

let deferredInstall = null;
let recorder = null;
let recordedChunks = [];
let pendingRecordedBlob = null;
let pendingRecordedMime = "";
let mediaBackend = "checking";

const $ = (sel) => document.querySelector(sel);

init();

async function init() {
  bindTabs();
  bindInstall();
  bindProfiles();
  bindSessions();
  bindAudio();
  bindProgress();
  bindImportExport();
  setTodayDefaults();

  mediaBackend = await detectMediaBackend();
  setStorageStatus();

  await renderAll();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
  }
}

function loadState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(DB_KEY) || "null");
    if (!saved) {
      for (const key of LEGACY_KEYS) {
        saved = JSON.parse(localStorage.getItem(key) || "null");
        if (saved) break;
      }
    }
  } catch {
    saved = null;
  }
  return {
    dogs: saved?.dogs || [],
    sessions: saved?.sessions || [],
    audioCues: saved?.audioCues || [],
    progress: saved?.progress || []
  };
}

function saveState() {
  localStorage.setItem(DB_KEY, JSON.stringify(state));
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function setTodayDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  const sd = $("#sessionDate");
  const pd = $("#progressDate");
  if (sd && !sd.value) sd.value = today;
  if (pd && !pd.value) pd.value = today;
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $("#" + btn.dataset.tab).classList.add("active");
    });
  });
}

function bindInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
    $("#installBtn").classList.remove("hidden");
  });
  $("#installBtn").addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    $("#installBtn").classList.add("hidden");
  });
}

async function detectMediaBackend() {
  if (navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const testDir = await root.getDirectoryHandle(MEDIA_ROOT, { create: true });
      const testFile = await testDir.getFileHandle("__test.txt", { create: true });
      const writable = await testFile.createWritable();
      await writable.write("ok");
      await writable.close();
      await testDir.removeEntry("__test.txt");
      return "opfs";
    } catch (err) {
      console.warn("OPFS unavailable, falling back to IndexedDB:", err);
    }
  }

  try {
    await idbOpen();
    return "idb";
  } catch (err) {
    console.warn("IndexedDB unavailable, falling back to localStorage base64 media:", err);
    return "localStorage";
  }
}

function setStorageStatus() {
  const node = $("#storageStatus");
  if (!node) return;
  const label = mediaBackend === "opfs"
    ? "Media storage: OPFS"
    : mediaBackend === "idb"
      ? "Media storage: IndexedDB fallback"
      : "Media storage: localStorage fallback";
  node.textContent = label;
}

async function idbOpen() {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, blob) {
  const db = await idbOpen();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await idbOpen();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function getMediaDir(subdir = "") {
  let dir = await navigator.storage.getDirectory();
  dir = await dir.getDirectoryHandle(MEDIA_ROOT, { create: true });
  if (subdir) dir = await dir.getDirectoryHandle(subdir, { create: true });
  return dir;
}

function safeExtension(fileName = "", fallback = "bin") {
  const ext = String(fileName).split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext || fallback;
}

async function putFileToOPFS(subdir, fileOrBlob, suggestedName, mimeType = "") {
  const dir = await getMediaDir(subdir);
  const ext = safeExtension(suggestedName, mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") ? "mp3" : mimeType.includes("image") ? "jpg" : "bin");
  const fileName = `${uid(subdir)}.${ext}`;
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(fileOrBlob);
  await writable.close();
  return {
    backend: "opfs",
    path: `${subdir}/${fileName}`,
    name: fileName,
    mimeType: mimeType || fileOrBlob.type || "application/octet-stream",
    originalName: suggestedName
  };
}

async function putMedia(subdir, fileOrBlob, suggestedName, mimeType = "") {
  const type = mimeType || fileOrBlob.type || "application/octet-stream";

  if (mediaBackend === "opfs") {
    try {
      return await putFileToOPFS(subdir, fileOrBlob, suggestedName, type);
    } catch (err) {
      console.warn("OPFS write failed during save. Switching to IndexedDB fallback.", err);
      mediaBackend = "idb";
      setStorageStatus();
    }
  }

  const ext = safeExtension(suggestedName, type.includes("wav") ? "wav" : type.includes("mpeg") ? "mp3" : type.includes("image") ? "jpg" : "bin");
  const fileName = `${uid(subdir)}.${ext}`;
  const path = `${subdir}/${fileName}`;

  if (mediaBackend === "idb") {
    try {
      await idbPut(path, fileOrBlob);
      return {
        backend: "idb",
        path,
        name: fileName,
        mimeType: type,
        originalName: suggestedName
      };
    } catch (err) {
      console.warn("IndexedDB media write failed. Falling back to localStorage base64.", err);
      mediaBackend = "localStorage";
      setStorageStatus();
    }
  }

  const dataUrl = await blobToDataUrl(fileOrBlob);
  localStorage.setItem(`media:${path}`, dataUrl);
  return {
    backend: "localStorage",
    path,
    name: fileName,
    mimeType: type,
    originalName: suggestedName
  };
}

async function getOPFSFile(path) {
  const [subdir, fileName] = path.split("/");
  const dir = await getMediaDir(subdir);
  const handle = await dir.getFileHandle(fileName);
  return await handle.getFile();
}

async function getMediaBlob(media) {
  if (!media?.path) return null;

  if (media.backend === "opfs" || (!media.backend && mediaBackend === "opfs")) {
    try { return await getOPFSFile(media.path); } catch (err) { console.warn("OPFS read failed", err); }
  }

  if (media.backend === "idb" || mediaBackend === "idb") {
    try {
      const blob = await idbGet(media.path);
      if (blob) return blob;
    } catch (err) { console.warn("IDB read failed", err); }
  }

  const dataUrl = localStorage.getItem(`media:${media.path}`);
  if (dataUrl) return dataUrlToBlob(dataUrl);

  return null;
}

async function getMediaObjectUrl(media) {
  const blob = await getMediaBlob(media);
  return blob ? URL.createObjectURL(blob) : "";
}

async function deleteMedia(media) {
  if (!media?.path) return;
  try {
    if (media.backend === "opfs") {
      const [subdir, fileName] = media.path.split("/");
      const dir = await getMediaDir(subdir);
      await dir.removeEntry(fileName);
    } else if (media.backend === "idb") {
      await idbDelete(media.path);
    } else {
      localStorage.removeItem(`media:${media.path}`);
    }
  } catch (err) {
    console.warn("Could not delete media:", media.path, err);
  }
}

function bindProfiles() {
  $("#profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const id = $("#profileId").value || uid("dog");
      const existing = state.dogs.find(d => d.id === id);
      const photoFile = $("#dogPhoto").files[0];
      let photo = existing?.photo || null;

      if (photoFile) {
        if (existing?.photo) await deleteMedia(existing.photo);
        photo = await putMedia("photos", photoFile, photoFile.name, photoFile.type);
      }

      const dog = {
        id,
        name: $("#dogName").value.trim(),
        breed: $("#dogBreed").value.trim(),
        age: $("#dogAge").value.trim(),
        temperament: $("#dogTemperament").value.trim(),
        notes: $("#dogNotes").value.trim(),
        photo,
        updatedAt: new Date().toISOString()
      };

      const index = state.dogs.findIndex(d => d.id === id);
      if (index >= 0) state.dogs[index] = dog;
      else state.dogs.push(dog);

      saveState();
      resetProfileForm();
      await renderAll();
    } catch (err) {
      console.error(err);
      alert("Profile save failed: " + err.message);
    }
  });

  $("#profileCancel").addEventListener("click", resetProfileForm);
}

function editProfile(id) {
  const dog = state.dogs.find(d => d.id === id);
  if (!dog) return;
  $("#profileId").value = dog.id;
  $("#dogName").value = dog.name || "";
  $("#dogBreed").value = dog.breed || "";
  $("#dogAge").value = dog.age || "";
  $("#dogTemperament").value = dog.temperament || "";
  $("#dogNotes").value = dog.notes || "";
  $("#dogPhoto").value = "";
  $("#profileSubmit").textContent = "Update Profile";
  $("#profileCancel").classList.remove("hidden");
  document.querySelector('[data-tab="profiles"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteProfile(id) {
  const dog = state.dogs.find(d => d.id === id);
  if (!dog) return;
  if (!confirm(`Delete ${dog.name}? Sessions and progress logs for this dog will remain but show as archived.`)) return;
  if (dog.photo) await deleteMedia(dog.photo);
  state.dogs = state.dogs.filter(d => d.id !== id);
  saveState();
  await renderAll();
}

function resetProfileForm() {
  $("#profileForm").reset();
  $("#profileId").value = "";
  $("#profileSubmit").textContent = "Save Profile";
  $("#profileCancel").classList.add("hidden");
}

async function renderProfiles() {
  const list = $("#profileList");
  list.innerHTML = "";
  if (!state.dogs.length) return list.append(emptyNode());

  for (const dog of state.dogs) {
    const card = document.createElement("article");
    card.className = "card item";
    let photoHtml = `<div class="avatar placeholder">${escapeHtml((dog.name || "?").slice(0, 1).toUpperCase())}</div>`;

    if (dog.photo?.path) {
      try {
        const url = await getMediaObjectUrl(dog.photo);
        if (url) photoHtml = `<img class="avatar" src="${url}" alt="${escapeHtml(dog.name)} profile photo" />`;
      } catch {
        photoHtml = `<div class="avatar placeholder">?</div>`;
      }
    }

    card.innerHTML = `
      <div class="profile-row">
        ${photoHtml}
        <div>
          <div class="item-top">
            <div>
              <h3 class="item-title">${escapeHtml(dog.name)}</h3>
              <p class="item-meta">${escapeHtml([dog.breed, dog.age, dog.temperament].filter(Boolean).join(" • "))}</p>
            </div>
            <div class="item-actions">
              <button class="small secondary" data-action="edit-profile" data-id="${dog.id}">Edit</button>
              <button class="small danger" data-action="delete-profile" data-id="${dog.id}">Delete</button>
            </div>
          </div>
          <p>${escapeHtml(dog.notes || "No notes yet.")}</p>
        </div>
      </div>
    `;
    list.append(card);
  }
}

function bindSessions() {
  $("#sessionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (!state.dogs.length) {
        alert("Please add a dog profile before saving sessions.");
        return;
      }
      state.sessions.unshift({
        id: uid("session"),
        dogId: $("#sessionDog").value,
        date: $("#sessionDate").value,
        duration: $("#sessionDuration").value.trim(),
        environment: $("#sessionEnvironment").value.trim(),
        skills: $("#sessionSkills").value.trim(),
        notes: $("#sessionNotes").value.trim(),
        createdAt: new Date().toISOString()
      });
      saveState();
      $("#sessionForm").reset();
      setTodayDefaults();
      await renderAll();
    } catch (err) {
      console.error(err);
      alert("Session save failed: " + err.message);
    }
  });
}

function renderSessions() {
  const list = $("#sessionList");
  list.innerHTML = "";
  if (!state.sessions.length) return list.append(emptyNode());

  for (const s of state.sessions) {
    const dog = state.dogs.find(d => d.id === s.dogId);
    const card = document.createElement("article");
    card.className = "card item";
    card.innerHTML = `
      <div class="item-top">
        <div>
          <h3 class="item-title">${escapeHtml(dog?.name || "Archived dog")}</h3>
          <p class="item-meta">${escapeHtml([s.date, s.duration, s.environment].filter(Boolean).join(" • "))}</p>
        </div>
        <button class="small danger" data-action="delete-session" data-id="${s.id}">Delete</button>
      </div>
      <p><strong>Skills:</strong> ${escapeHtml(s.skills || "Not specified")}</p>
      <p>${escapeHtml(s.notes || "No notes.")}</p>
    `;
    list.append(card);
  }
}

function bindAudio() {
  $("#audioForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const id = $("#audioId").value || uid("audio");
      const existing = state.audioCues.find(a => a.id === id);
      const file = $("#audioFile").files[0];
      let media = existing?.media || null;

      if (file) {
        if (existing?.media) await deleteMedia(existing.media);
        media = await putMedia("audio", file, file.name, file.type || "audio/mpeg");
      } else if (pendingRecordedBlob) {
        if (existing?.media) await deleteMedia(existing.media);
        const ext = pendingRecordedMime.includes("wav") ? "wav" : "webm";
        media = await putMedia("audio", pendingRecordedBlob, `recording.${ext}`, pendingRecordedMime || "audio/webm");
      }

      const cue = {
        id,
        name: $("#audioName").value.trim(),
        category: $("#audioCategory").value.trim(),
        notes: $("#audioNotes").value.trim(),
        media,
        updatedAt: new Date().toISOString()
      };

      const index = state.audioCues.findIndex(a => a.id === id);
      if (index >= 0) state.audioCues[index] = cue;
      else state.audioCues.push(cue);

      saveState();
      resetAudioForm();
      await renderAll();
    } catch (err) {
      console.error(err);
      alert("Audio cue save failed: " + err.message);
    }
  });

  $("#audioCancel").addEventListener("click", resetAudioForm);
  $("#recordBtn").addEventListener("click", startRecording);
  $("#stopRecordBtn").addEventListener("click", stopRecording);
}

async function startRecording() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Audio recording is not available in this browser/context. Import MP3 or WAV instead.");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    pendingRecordedBlob = null;
    pendingRecordedMime = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("audio/webm") ? "audio/webm" : "";
    recorder = new MediaRecorder(stream, pendingRecordedMime ? { mimeType: pendingRecordedMime } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    recorder.onstop = () => {
      pendingRecordedBlob = new Blob(recordedChunks, { type: pendingRecordedMime || "audio/webm" });
      stream.getTracks().forEach(track => track.stop());
      $("#recordingStatus").textContent = "Recording captured. Save the cue to store it.";
      $("#recordBtn").classList.remove("hidden");
      $("#stopRecordBtn").classList.add("hidden");
    };
    recorder.start();
    $("#recordingStatus").textContent = "Recording...";
    $("#recordBtn").classList.add("hidden");
    $("#stopRecordBtn").classList.remove("hidden");
  } catch (err) {
    $("#recordingStatus").textContent = "Recording failed or permission was denied.";
    console.error(err);
  }
}

function stopRecording() {
  if (recorder && recorder.state === "recording") recorder.stop();
}

function editAudio(id) {
  const cue = state.audioCues.find(a => a.id === id);
  if (!cue) return;
  $("#audioId").value = cue.id;
  $("#audioName").value = cue.name || "";
  $("#audioCategory").value = cue.category || "";
  $("#audioNotes").value = cue.notes || "";
  $("#audioFile").value = "";
  pendingRecordedBlob = null;
  $("#recordingStatus").textContent = cue.media?.path ? "Existing audio will be kept unless you import or record a replacement." : "Ready to record.";
  $("#audioSubmit").textContent = "Update Audio Cue";
  $("#audioCancel").classList.remove("hidden");
  document.querySelector('[data-tab="audio"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteAudio(id) {
  const cue = state.audioCues.find(a => a.id === id);
  if (!cue) return;
  if (!confirm(`Delete audio cue "${cue.name}"?`)) return;
  if (cue.media) await deleteMedia(cue.media);
  state.audioCues = state.audioCues.filter(a => a.id !== id);
  saveState();
  await renderAll();
}

function resetAudioForm() {
  $("#audioForm").reset();
  $("#audioId").value = "";
  pendingRecordedBlob = null;
  pendingRecordedMime = "";
  $("#recordingStatus").textContent = "Ready to record. Browser permission may be requested.";
  $("#audioSubmit").textContent = "Save Audio Cue";
  $("#audioCancel").classList.add("hidden");
}

async function renderAudio() {
  const list = $("#audioList");
  list.innerHTML = "";
  if (!state.audioCues.length) return list.append(emptyNode());

  for (const cue of state.audioCues) {
    const card = document.createElement("article");
    card.className = "card item";
    let player = `<p class="item-meta">No audio file attached.</p>`;

    if (cue.media?.path) {
      try {
        const url = await getMediaObjectUrl(cue.media);
        if (url) player = `<audio class="audio-player" controls preload="metadata" src="${url}"></audio>`;
        else player = `<p class="item-meta">Audio file missing from storage.</p>`;
      } catch {
        player = `<p class="item-meta">Audio file could not be loaded.</p>`;
      }
    }

    card.innerHTML = `
      <div class="item-top">
        <div>
          <h3 class="item-title">${escapeHtml(cue.name)}</h3>
          <p class="item-meta">${escapeHtml(cue.category || "Uncategorized")}</p>
        </div>
        <div class="item-actions">
          <button class="small secondary" data-action="edit-audio" data-id="${cue.id}">Edit</button>
          <button class="small danger" data-action="delete-audio" data-id="${cue.id}">Delete</button>
        </div>
      </div>
      ${player}
      <p>${escapeHtml(cue.notes || "No notes.")}</p>
    `;
    list.append(card);
  }
}

function bindProgress() {
  $("#progressForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (!state.dogs.length) {
        alert("Please add a dog profile before saving progress.");
        return;
      }
      state.progress.unshift({
        id: uid("progress"),
        dogId: $("#progressDog").value,
        date: $("#progressDate").value,
        metric: $("#progressMetric").value,
        score: Number($("#progressScore").value || 0),
        notes: $("#progressNotes").value.trim(),
        createdAt: new Date().toISOString()
      });
      saveState();
      $("#progressForm").reset();
      setTodayDefaults();
      await renderAll();
    } catch (err) {
      console.error(err);
      alert("Progress save failed: " + err.message);
    }
  });
}

function renderProgress() {
  const list = $("#progressList");
  list.innerHTML = "";
  if (!state.progress.length) return list.append(emptyNode());

  for (const p of state.progress) {
    const dog = state.dogs.find(d => d.id === p.dogId);
    const card = document.createElement("article");
    card.className = "card item";
    card.innerHTML = `
      <div class="item-top">
        <div>
          <h3 class="item-title">${escapeHtml(p.metric)} — ${escapeHtml(dog?.name || "Archived dog")}</h3>
          <p class="item-meta">${escapeHtml(p.date)} • Score: ${escapeHtml(p.score)}/5</p>
        </div>
        <button class="small danger" data-action="delete-progress" data-id="${p.id}">Delete</button>
      </div>
      <p>${escapeHtml(p.notes || "No notes.")}</p>
    `;
    list.append(card);
  }
}

function renderDogSelects() {
  const selects = [$("#sessionDog"), $("#progressDog")].filter(Boolean);
  for (const select of selects) {
    const current = select.value;
    select.innerHTML = "";
    if (!state.dogs.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Add a dog profile first";
      select.append(opt);
      select.disabled = true;
    } else {
      select.disabled = false;
      for (const dog of state.dogs) {
        const opt = document.createElement("option");
        opt.value = dog.id;
        opt.textContent = dog.name;
        select.append(opt);
      }
      if (current) select.value = current;
    }
  }
}

function bindImportExport() {
  $("#exportZipBtn").addEventListener("click", exportZipPack);

  $("#importZipInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    await importZipPack(file);
    event.target.value = "";
  });

  document.body.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "edit-profile") editProfile(id);
    if (action === "delete-profile") await deleteProfile(id);
    if (action === "edit-audio") editAudio(id);
    if (action === "delete-audio") await deleteAudio(id);
    if (action === "delete-session") {
      state.sessions = state.sessions.filter(s => s.id !== id);
      saveState();
      await renderAll();
    }
    if (action === "delete-progress") {
      state.progress = state.progress.filter(p => p.id !== id);
      saveState();
      await renderAll();
    }
  });
}

async function exportZipPack() {
  try {
    const zip = {};
    const manifest = {
      app: "LMA Dog Trainer",
      version: 5,
      exportedAt: new Date().toISOString(),
      storage: "json-manifest-plus-media-files",
      data: state
    };

    zip["pack.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

    for (const dog of state.dogs) {
      if (dog.photo?.path) {
        const blob = await getMediaBlob(dog.photo);
        if (blob) zip[`media/${dog.photo.path}`] = new Uint8Array(await blob.arrayBuffer());
      }
    }

    for (const cue of state.audioCues) {
      if (cue.media?.path) {
        const blob = await getMediaBlob(cue.media);
        if (blob) zip[`media/${cue.media.path}`] = new Uint8Array(await blob.arrayBuffer());
      }
    }

    const blob = new Blob([fflate.zipSync(zip)], { type: "application/zip" });
    downloadBlob(blob, `LMA-Dog-Trainer-Pack-${new Date().toISOString().slice(0,10)}.zip`);
  } catch (err) {
    console.error(err);
    alert("Export failed: " + err.message);
  }
}

async function importZipPack(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = fflate.unzipSync(bytes);
    const manifestEntry = entries["pack.json"];
    if (!manifestEntry) throw new Error("No pack.json found.");

    const manifest = JSON.parse(new TextDecoder().decode(manifestEntry));
    if (!manifest.data) throw new Error("Invalid LMA Dog Trainer pack.");

    const importedState = {
      dogs: manifest.data.dogs || [],
      sessions: manifest.data.sessions || [],
      audioCues: manifest.data.audioCues || [],
      progress: manifest.data.progress || []
    };

    for (const [zipPath, data] of Object.entries(entries)) {
      if (!zipPath.startsWith("media/")) continue;
      const relative = zipPath.replace(/^media\//, "");
      const [subdir, fileName] = relative.split("/");
      if (!subdir || !fileName) continue;
      const mediaBlob = new Blob([data]);
      if (mediaBackend === "opfs") {
        try {
          const dir = await getMediaDir(subdir);
          const handle = await dir.getFileHandle(fileName, { create: true });
          const writable = await handle.createWritable();
          await writable.write(mediaBlob);
          await writable.close();
          continue;
        } catch (err) {
          console.warn("OPFS import failed, using fallback", err);
          mediaBackend = "idb";
          setStorageStatus();
        }
      }
      if (mediaBackend === "idb") {
        try {
          await idbPut(relative, mediaBlob);
          continue;
        } catch (err) {
          console.warn("IDB import failed, using localStorage fallback", err);
          mediaBackend = "localStorage";
          setStorageStatus();
        }
      }
      localStorage.setItem(`media:${relative}`, await blobToDataUrl(mediaBlob));
    }

    // Normalize backend markers to current fallback when needed.
    for (const dog of importedState.dogs) {
      if (dog.photo?.path) dog.photo.backend = mediaBackend;
    }
    for (const cue of importedState.audioCues) {
      if (cue.media?.path) cue.media.backend = mediaBackend;
    }

    state.dogs = importedState.dogs;
    state.sessions = importedState.sessions;
    state.audioCues = importedState.audioCues;
    state.progress = importedState.progress;
    saveState();
    await renderAll();
    alert("ZIP pack imported successfully.");
  } catch (err) {
    console.error(err);
    alert("Import failed: " + err.message);
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function emptyNode() {
  return $("#emptyTemplate").content.firstElementChild.cloneNode(true);
}

async function renderAll() {
  renderDogSelects();
  await renderProfiles();
  renderSessions();
  await renderAudio();
  renderProgress();
}

window.__LMA_DOG_TRAINER_STATE__ = state;
