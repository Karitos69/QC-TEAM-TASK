// script.js (ESM) — Firebase + Firestore + Anonymous Auth

// ---------- Firebase (CDN ESM) ----------
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDocs,
  onSnapshot, query, where, orderBy, serverTimestamp, Timestamp, setDoc, getDoc
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// ---- Firebase config ----
const firebaseConfig = {
  apiKey: "AIzaSyCLdR40w6I4EtddnZqvakj1jc0GhgfvDgo",
  authDomain: "qc-team-task.firebaseapp.com",
  projectId: "qc-team-task",
  storageBucket: "qc-team-task.firebasestorage.app",
  messagingSenderId: "763034831391",
  appId: "1:763034831391:web:9e084ad0bff8ccd839232a",
  measurementId: "G-KF05HFQDGJ"
};

// ---- Init ----
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ---- Auth (Anonymous) ----
const auth = getAuth(app);
function ensureAnonAuth() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) { unsub(); resolve(user); }
    }, reject);
    signInAnonymously(auth).catch((err) => {
      console.warn('Anonymous sign-in failed:', err);
      // keep listening via onAuthStateChanged
    });
  });
}

// ---- Helpers ----
async function getServerNow() {
  try {
    const ref = doc(db, '_meta', 'server-time');
    await setDoc(ref, { now: serverTimestamp() }, { merge: true });
    const snap = await getDoc(ref);
    const ts = snap.data()?.now;
    return ts?.toDate ? ts.toDate() : new Date();
  } catch {
    return new Date();
  }
}
const genId = () => (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

// ---------- App code ----------
document.addEventListener('DOMContentLoaded', () => {
  // --- STATE ---
  let tasks = [];
  let currentViewDate = new Date();
  let selectedDate = new Date();
  let currentEditingTaskId = null;

  // track if firestore is available; fall back to localStorage if needed
  let firestoreReady = false;
  let firstSnapResolved;
  const firstSnap = new Promise(res => (firstSnapResolved = res));

  // --- CONSTANTS ---
  const DEPARTMENTS = {
    QA: 'var(--dept-qa)',
    DEV: 'var(--dept-dev)',
    Productio: 'var(--dept-productio)',
    QC: 'var(--dept-qc)',
    Other: 'var(--dept-other)'
  };
  const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // --- DOM CACHE ---
  const mainContent = document.getElementById('app-main-content');
  const navLinks = document.querySelectorAll('.nav-link');
  const views = document.querySelectorAll('.view');
  const calendarGrid = document.getElementById('calendar-grid');
  const calendarWeekdays = document.getElementById('calendar-weekdays');
  const monthYearHeader = document.getElementById('month-year-header');
  const prevMonthBtn = document.getElementById('prev-month-btn');
  const nextMonthBtn = document.getElementById('next-month-btn');
  const todayBtn = document.getElementById('today-btn');
  const addTaskForDateBtn = document.getElementById('add-task-for-date-btn');

  const todayTasksContainer = document.getElementById('today-tasks');
  const tomorrowTasksContainer = document.getElementById('tomorrow-tasks');
  const alertsTasksContainer = document.getElementById('alerts-tasks');

  const reportsTableBody = document.getElementById('reports-table-body');
  const reportDateFilter = document.getElementById('report-date-filter');
  const exportPdfBtn = document.getElementById('export-pdf-btn');
  const weeklyCleanupToggle = document.getElementById('weekly-cleanup-toggle');
  const weeklyCleanupLabel = document.getElementById('weekly-cleanup-label');

  const taskModal = document.getElementById('task-modal');
  const modalTitle = document.getElementById('modal-title');
  const taskForm = document.getElementById('task-form');
  const taskIdInput = document.getElementById('task-id');
  const taskTitleInput = document.getElementById('task-title');
  const taskDateInput = document.getElementById('task-date');
  const taskEtaInput = document.getElementById('task-eta');
  const taskImportantCheckbox = document.getElementById('task-important');
  const statusFormGroup = document.getElementById('status-form-group');
  const taskStatusSelect = document.getElementById('task-status');
  const taskDepartmentSelect = document.getElementById('task-department');
  const taskAssigneeInput = document.getElementById('task-assignee');
  const taskReminderToggle = document.getElementById('task-reminder-toggle');
  const reminderFields = document.getElementById('reminder-fields');
  const taskReminderDate = document.getElementById('task-reminder-date');
  const taskReminderTime = document.getElementById('task-reminder-time');
  const subtasksList = document.getElementById('subtasks-list');
  const addSubtaskBtn = document.getElementById('add-subtask-btn');
  const subtaskProgressLabel = document.getElementById('subtask-progress-label');
  const taskNotesInput = document.getElementById('task-notes');
  const saveTaskBtn = document.getElementById('save-task-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const editModalHeaderActions = document.getElementById('edit-modal-header-actions');

  const confirmModal = document.getElementById('confirm-modal');
  const confirmModalTitle = document.getElementById('confirm-modal-title');
  const confirmModalBody = document.getElementById('confirm-modal-body');
  const confirmModalInput = document.getElementById('confirm-modal-input');
  const confirmModalConfirmBtn = document.getElementById('confirm-modal-confirm-btn');
  const confirmModalCancelBtn = document.getElementById('confirm-modal-cancel-btn');

  // --- Utils ---
  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2,'0');
    const d = String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  };
  const formatTime = (date) => date.toTimeString().slice(0,5);
  const showToast = (msg, type='info', dur=3000) => {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
    c.appendChild(t); setTimeout(()=>t.classList.add('show'),10);
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),300); }, dur);
  };
  const getPriority = () => document.querySelector('input[name="priority"]:checked').value;
  const setPriority = (p) => { const r = document.querySelector(`input[name="priority"][value="${p}"]`); if (r) r.checked = true; };

  // ---- Storage: Firestore (primary) + localStorage (fallback) ----
  const LS_KEY = 'qa_tasks';

  // Local fallback
  const lsSave = () => localStorage.setItem(LS_KEY, JSON.stringify(tasks));
  const lsLoad = () => {
    const s = localStorage.getItem(LS_KEY);
    tasks = s ? JSON.parse(s) : [];
  };

  // Firestore realtime
  function startTasksListener() {
    const q = query(collection(db, 'tasks'), orderBy('date'), orderBy('createdAt'));
    return onSnapshot(q, snap => {
      tasks = snap.docs.map(d => {
        const t = d.data();
        return {
          id: d.id,
          ...t,
          createdAt: t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : t.createdAt || null,
          updatedAt: t.updatedAt?.toDate ? t.updatedAt.toDate().toISOString() : t.updatedAt || null,
          doneAt: t.doneAt?.toDate ? t.doneAt.toDate().toISOString() : t.doneAt || null
        };
      });
      if (!firestoreReady) { firestoreReady = true; firstSnapResolved(); }
      renderCurrentView();
    }, err => {
      console.warn('Firestore listener error, using localStorage fallback:', err);
      if (!firestoreReady) { firestoreReady = false; firstSnapResolved(); }
    });
  }

  async function createTaskFS(data) {
    await addDoc(collection(db, 'tasks'), {
      ...data,
      status: data.status || 'in_progress',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      doneAt: null
    });
  }
  async function updateTaskFS(id, updates) {
    await updateDoc(doc(db, 'tasks', id), { ...updates, updatedAt: serverTimestamp() });
  }
  async function deleteTaskFS(id) { await deleteDoc(doc(db, 'tasks', id)); }

  // --- Core logic ---
  const runDailyRollover = async () => {
    const today = new Date(); today.setHours(0,0,0,0);
    let changed = 0;

    for (const t of tasks) {
      const tDate = new Date(t.date + 'T00:00:00');
      const hasOpenSubs = Array.isArray(t.subtasks) && t.subtasks.some(st => !st.done);
      if ((t.status !== 'done' || hasOpenSubs) && tDate < today) {
        if (firestoreReady) {
          await updateTaskFS(t.id, { date: formatDate(today), status: 'delayed' });
        } else {
          t.date = formatDate(today); t.status = 'delayed';
        }
        changed++;
      }
    }
    if (changed) {
      if (!firestoreReady) lsSave();
      showToast(`Overdue tasks moved to today.`, 'info');
    }
  };

  const runWeeklyCleanup = async () => {
    const setting = localStorage.getItem('qa_weekly_cleanup') === 'true';
    weeklyCleanupToggle.checked = setting;
    weeklyCleanupLabel.textContent = setting ? 'On' : 'Off';
    if (!setting) return;

    const now = await getServerNow();
    if (now.getDay() !== 0) return; // only Sunday
    const todayKey = formatDate(now);
    if (localStorage.getItem('qa_last_cleanup') === todayKey) return;

    const sevenAgo = new Date(now); sevenAgo.setDate(now.getDate()-7);
    let deleted = 0;

    for (const t of [...tasks]) {
      if (t.status === 'done' && t.doneAt && new Date(t.doneAt) <= sevenAgo) {
        if (firestoreReady) await deleteTaskFS(t.id);
        deleted++;
      }
    }
    localStorage.setItem('qa_last_cleanup', todayKey);
    if (deleted) showToast(`${deleted} old 'Done' tasks cleared.`, 'success');
  };

  // --- Rendering ---
  const renderCurrentView = () => {
    const activeLink = document.querySelector('.nav-link.active');
    if (!activeLink) return;
    const viewName = activeLink.dataset.view;
    if (viewName === 'calendar') renderCalendar();
    if (viewName === 'tasks') renderTasksView();
    if (viewName === 'reports') renderReportsView();
  };

  const renderCalendar = () => {
    monthYearHeader.textContent = currentViewDate.toLocaleDateString('en-US',{month:'long',year:'numeric'});
    const m = currentViewDate.getMonth();
    const y = currentViewDate.getFullYear();
    const first = new Date(y,m,1);
    const dim = new Date(y,m+1,0).getDate();
    const startDow = first.getDay();

    calendarGrid.innerHTML = '';
    if (calendarWeekdays.children.length === 0) {
      WEEKDAYS.forEach(d => calendarWeekdays.innerHTML += `<div>${d}</div>`);
    }
    for (let i=0;i<startDow;i++) calendarGrid.innerHTML += `<div class="calendar-day other-month"></div>`;

    for (let day=1; day<=dim; day++){
      const date = new Date(y,m,day);
      const dateStr = formatDate(date);
      const cell = document.createElement('div');
      cell.className = 'calendar-day';
      cell.dataset.date = dateStr;

      const num = document.createElement('span');
      num.className = 'day-number';
      num.textContent = day;
      if (dateStr === formatDate(new Date())) num.classList.add('today');
      if (dateStr === formatDate(selectedDate)) cell.classList.add('selected');
      cell.appendChild(num);

      tasks.filter(t => t.date === dateStr).forEach(task => {
        const bar = document.createElement('div');
        bar.className = 'task-bar';
        bar.style.backgroundColor = DEPARTMENTS[task.department] || 'var(--dept-other)';
        bar.dataset.taskId = task.id;

        let badges = '';
        if (task.priority === 'urgent') badges += '<span>⚠ </span>';
        if (task.important) badges += '<span>★ </span>';
        if (task.status === 'delayed') badges += '<span>Delayed </span>';

        let subCounter = '';
        if (task.subtasks?.length) {
          const doneCount = task.subtasks.filter(st => st.done).length;
          subCounter = `<span class="subtask-counter">${doneCount}/${task.subtasks.length}</span>`;
        }
        bar.innerHTML = `<div class="task-bar-content"><span class="badges">${badges}</span>${task.title}${subCounter}</div>`;
        bar.title = `Title: ${task.title}\nDepartment: ${task.department||'N/A'}\nPriority: ${task.priority}\nStatus: ${task.status.replace('_',' ')}`;
        cell.appendChild(bar);
      });
      calendarGrid.appendChild(cell);
    }
  };

  const renderTasksView = () => {
    const todayStr = formatDate(new Date());
    const tmr = new Date(); tmr.setDate(tmr.getDate()+1);
    const tomStr = formatDate(tmr);

    const today = tasks.filter(t => t.date === todayStr);
    const tomorrow = tasks.filter(t => t.date === tomStr);
    const alerts = tasks.filter(t => t.important || t.status === 'delayed' || (t.reminderAt && new Date(t.reminderAt) > new Date()));

    const itemHTML = (task) => {
      const reminderText = task.reminderAt ? `<span class="status-reminder">Reminder at ${formatTime(new Date(task.reminderAt))}</span>` : '';
      return `
        <div class="task-item" data-task-id="${task.id}">
          <div class="task-item-header">
            <span class="task-item-title">${task.title}</span>
            <div class="task-item-actions">
              <button class="mark-done-btn" title="Mark Done">✓</button>
              <button class="more-btn" title="Edit / More actions">...</button>
            </div>
          </div>
          <div class="task-item-details">
            ${task.department ? `<span class="chip" style="background-color:${DEPARTMENTS[task.department]||'var(--dept-other)'}">${task.department}</span>`:''}
            <span class="priority-badge priority-${task.priority}">${task.priority}</span>
            <span class="status-badge status-${task.status.replace('_','')}">${task.status.replace('_',' ')}</span>
            ${task.important ? '<span class="status-important">★ Important</span>':''}
            ${task.assignee ? `<span>${task.assignee}</span>`:''}
            ${reminderText}
          </div>
        </div>`;
    };

    todayTasksContainer.innerHTML = `<h3>Today — ${todayStr} <button class="btn-text add-task-btn" data-date="${todayStr}">+ Add Task</button></h3>` +
      (today.length ? today.map(itemHTML).join('') : '<p>No tasks scheduled.</p>');

    tomorrowTasksContainer.innerHTML = `<h3>Tomorrow — ${tomStr} <button class="btn-text add-task-btn" data-date="${tomStr}">+ Add Task</button></h3>` +
      (tomorrow.length ? tomorrow.map(itemHTML).join('') : '<p>No tasks scheduled.</p>');

    alertsTasksContainer.innerHTML = `<h3>Alerts</h3>` + (alerts.length ? alerts.map(itemHTML).join('') : '<p>No alerts.</p>');
  };

  const renderReportsView = () => {
    const val = reportDateFilter.value;
    const now = new Date();
    let start;
    if (val !== 'all') { start = new Date(); start.setDate(now.getDate() - parseInt(val,10)); }

    const done = tasks.filter(t => {
      if (t.status !== 'done' || !t.doneAt) return false;
      if (val === 'all') return true;
      return new Date(t.doneAt) >= start;
    }).sort((a,b)=> new Date(b.doneAt) - new Date(a.doneAt));

    reportsTableBody.innerHTML = done.map(t => `
      <tr>
        <td>${t.date}</td>
        <td>${t.title}</td>
        <td>${t.department || ''}</td>
        <td>${t.assignee || ''}</td>
        <td>${t.priority}</td>
        <td>${new Date(t.doneAt).toLocaleString()}</td>
        <td>${t.notes || ''}</td>
      </tr>`).join('');
  };

  // --- Modal / edit / create ---
  const openModal = (mode, taskId=null) => {
    taskForm.reset(); currentEditingTaskId = taskId;
    subtasksList.innerHTML = ''; setPriority('general');
    reminderFields.style.display = 'none'; editModalHeaderActions.innerHTML = '';

    if (mode === 'new') {
      modalTitle.textContent = 'New Task'; saveTaskBtn.textContent = 'Save Task';
      statusFormGroup.style.display = 'none'; taskDateInput.value = formatDate(selectedDate);
    } else {
      modalTitle.textContent = 'Edit Task'; saveTaskBtn.textContent = 'Update Task';
      statusFormGroup.style.display = 'block';
      const t = tasks.find(x => x.id === taskId); if (!t) return;
      taskIdInput.value = t.id; taskTitleInput.value = t.title; taskDateInput.value = t.date;
      taskEtaInput.value = t.etaDate || ''; setPriority(t.priority);
      taskImportantCheckbox.checked = !!t.important; taskStatusSelect.value = t.status;
      taskDepartmentSelect.value = t.department || ''; taskAssigneeInput.value = t.assignee || '';
      taskNotesInput.value = t.notes || '';
      if (t.reminderAt){
        reminderFields.style.display = 'flex';
        taskReminderToggle.checked = true;
        const rd = new Date(t.reminderAt);
        taskReminderDate.value = formatDate(rd);
        taskReminderTime.value = formatTime(rd);
      }
      (t.subtasks || []).forEach(st => addSubtaskToDOM(st.id, st.text, st.done));
      updateSubtaskProgress(t.id);
      setupEditHeaderActions(t.id);
    }
    taskModal.classList.add('active'); validateTaskForm();
  };

  const closeModal = () => { taskModal.classList.remove('active'); confirmModal.classList.remove('active'); };

  const setupEditHeaderActions = (taskId) => {
    editModalHeaderActions.innerHTML = `
      <button type="button" class="btn btn-secondary" data-action="done">Mark Done</button>
      <button type="button" class="btn btn-secondary" data-action="in_progress">Mark In Progress</button>
      <button type="button" class="btn btn-danger" data-action="delete">Delete</button>`;
    editModalHeaderActions.querySelector('[data-action="done"]').onclick = () => handleStatusChange(taskId,'done');
    editModalHeaderActions.querySelector('[data-action="in_progress"]').onclick = () => handleStatusChange(taskId,'in_progress');
    editModalHeaderActions.querySelector('[data-action="delete"]').onclick = () => confirmDeleteTask(taskId);
  };

  const addSubtaskToDOM = (id, text='', done=false) => {
    const subId = id || `subtask_${genId()}`;
    const li = document.createElement('li');
    li.className = 'subtask-item'; li.dataset.subtaskId = subId;
    li.innerHTML = `<input type="checkbox" ${done?'checked':''}><input type="text" class="form-control" placeholder="Describe a subtask…" value="${text}"><button type="button" class="remove-subtask-btn">🗑️</button>`;
    subtasksList.appendChild(li);
    li.querySelector('.remove-subtask-btn').onclick = () => li.remove();
  };

  const updateSubtaskProgress = (taskId) => {
    const t = tasks.find(x => x.id === taskId);
    if (!t?.subtasks?.length){ subtaskProgressLabel.textContent=''; return; }
    const done = t.subtasks.filter(st => st.done).length;
    subtaskProgressLabel.textContent = `(${done}/${t.subtasks.length})`;
  };

  const handleSaveTask = async () => {
    if (!validateTaskForm()) return;

    const subtasksData = Array.from(subtasksList.children).map(li => ({
      id: li.dataset.subtaskId,
      text: li.querySelector('input[type="text"]').value,
      done: li.querySelector('input[type="checkbox"]').checked
    })).filter(st => st.text.trim() !== '');

    const reminderAt = taskReminderToggle.checked && taskReminderDate.value && taskReminderTime.value
      ? new Date(`${taskReminderDate.value}T${taskReminderTime.value}`).toISOString()
      : null;

    const data = {
      title: taskTitleInput.value.trim(),
      date: taskDateInput.value,
      etaDate: taskEtaInput.value || null,
      priority: getPriority(),
      important: taskImportantCheckbox.checked,
      department: taskDepartmentSelect.value || null,
      assignee: taskAssigneeInput.value.trim() || null,
      notes: taskNotesInput.value.trim() || null,
      subtasks: subtasksData,
      reminderAt
    };

    try{
      if (currentEditingTaskId) {
        await updateTaskFS(currentEditingTaskId, { ...data, status: taskStatusSelect.value });
        showToast('Task updated.','success');
      } else {
        await createTaskFS({ ...data, status: 'in_progress' });
        showToast('Task created.','success');
      }
      closeModal();
    }catch(e){
      console.warn('Firestore write failed, saving locally:', e);
      if (currentEditingTaskId){
        const i = tasks.findIndex(t=>t.id===currentEditingTaskId);
        if (i>-1) tasks[i] = { ...tasks[i], ...data, status: taskStatusSelect.value, updatedAt: new Date().toISOString() };
      }else{
        tasks.push({ ...data, id: genId(), status:'in_progress', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
      lsSave(); closeModal(); renderCurrentView();
    }
  };

  const handleStatusChange = async (taskId, newStatus) => {
    const idx = tasks.findIndex(t=>t.id===taskId); if (idx===-1) return;
    const t = tasks[idx];
    if (newStatus==='done'){
      const hasUnchecked = (t.subtasks||[]).some(st=>!st.done);
      if (hasUnchecked){
        showConfirmation('Unchecked Subtasks','There are unchecked subtasks. Mark them all as done?', async () => {
          const subs = (t.subtasks||[]).map(s=>({...s,done:true}));
          try{ await updateTaskFS(taskId,{ status:'done', subtasks:subs, doneAt: serverTimestamp() }); }
          catch{ tasks[idx].status='done'; tasks[idx].subtasks=subs; tasks[idx].doneAt=new Date().toISOString(); lsSave(); renderCurrentView(); }
          closeModal();
        });
        return;
      }
    }
    try{
      await updateTaskFS(taskId, { status:newStatus, ...(newStatus==='done'?{doneAt:serverTimestamp()}: {}) });
    }catch{
      tasks[idx].status = newStatus;
      if (newStatus==='done') tasks[idx].doneAt = new Date().toISOString();
      lsSave(); renderCurrentView();
    }
  };

  const confirmDeleteTask = (taskId) => {
    showConfirmation('Delete task?','This action cannot be undone. Type DELETE to confirm.', async (val)=>{
      if (val==='DELETE'){
        try{ await deleteTaskFS(taskId); }
        catch{ tasks = tasks.filter(t=>t.id!==taskId); lsSave(); renderCurrentView(); }
        showToast('Task deleted.','info'); closeModal();
      } else {
        showToast('Deletion cancelled. Incorrect confirmation text.','error');
      }
    }, true);
  };

  const showConfirmation = (title, body, onConfirm, requireInput=false) => {
    confirmModalTitle.textContent = title; confirmModalBody.textContent = body;
    confirmModalInput.style.display = requireInput ? 'block':'none'; confirmModalInput.value='';
    const handler = () => { onConfirm(requireInput ? confirmModalInput.value : true); confirmModal.classList.remove('active'); confirmModalConfirmBtn.removeEventListener('click', handler); };
    confirmModalConfirmBtn.addEventListener('click', handler); confirmModal.classList.add('active');
  };

  const validateTaskForm = () => {
    let ok = true;
    if (!taskTitleInput.value.trim()) ok=false;
    if (!document.querySelector('input[name="priority"]:checked')) ok=false;
    if (taskReminderToggle.checked){
      const dt = new Date(`${taskReminderDate.value}T${taskReminderTime.value}`);
      if (!taskReminderDate.value || !taskReminderTime.value || dt < new Date()) ok=false;
    }
    if (taskEtaInput.value && taskDateInput.value && taskEtaInput.value < taskDateInput.value) ok=false;
    saveTaskBtn.disabled = !ok;
    return ok;
  };

  // --- Events ---
  navLinks.forEach(link => link.addEventListener('click', e => {
    e.preventDefault();
    navLinks.forEach(l=>l.classList.remove('active')); views.forEach(v=>v.classList.remove('active'));
    link.classList.add('active'); document.getElementById(link.dataset.view+'-view').classList.add('active'); renderCurrentView();
  }));
  prevMonthBtn.addEventListener('click', ()=>{ currentViewDate.setMonth(currentViewDate.getMonth()-1); renderCalendar(); });
  nextMonthBtn.addEventListener('click', ()=>{ currentViewDate.setMonth(currentViewDate.getMonth()+1); renderCalendar(); });
  todayBtn.addEventListener('click', ()=>{ currentViewDate=new Date(); selectedDate=new Date(); renderCalendar(); });
  addTaskForDateBtn.addEventListener('click', ()=> openModal('new'));

  calendarGrid.addEventListener('click', (e) => {
    const bar = e.target.closest('.task-bar');
    if (bar){ e.stopPropagation(); openModal('edit', bar.dataset.taskId); return; }
    const day = e.target.closest('.calendar-day');
    if (day?.dataset.date){ selectedDate = new Date(day.dataset.date + 'T00:00:00'); renderCalendar(); }
  });

  mainContent.addEventListener('click', e => {
    if (e.target.matches('.add-task-btn')){
      selectedDate = new Date(e.target.dataset.date + 'T00:00:00'); openModal('new');
    } else if (e.target.matches('.mark-done-btn')){
      handleStatusChange(e.target.closest('.task-item').dataset.taskId, 'done');
    } else if (e.target.matches('.more-btn')){
      openModal('edit', e.target.closest('.task-item').dataset.taskId);
    }
  });

  saveTaskBtn.addEventListener('click', handleSaveTask);
  cancelBtn.addEventListener('click', closeModal);
  confirmModalCancelBtn.addEventListener('click', ()=> confirmModal.classList.remove('active'));

  taskReminderToggle.addEventListener('change', () => {
    reminderFields.style.display = taskReminderToggle.checked ? 'flex' : 'none';
    if (taskReminderToggle.checked && !taskReminderDate.value){
      taskReminderDate.value = taskDateInput.value;
      taskReminderTime.value = '09:00';
    }
  });

  addSubtaskBtn.addEventListener('click', ()=> addSubtaskToDOM());
  taskForm.addEventListener('input', validateTaskForm);

  reportDateFilter.addEventListener('change', renderReportsView);
  exportPdfBtn.addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.autoTable({
      html: '#reports-table', startY: 20,
      headStyles: { fillColor: [41,128,185] },
      didDrawPage: data => doc.text("Done Task Report", data.settings.margin.left, 15)
    });
    doc.save('qa-done-tasks-report.pdf');
    showToast('PDF exported.','success');
  });

  weeklyCleanupToggle.addEventListener('change', () => {
    weeklyCleanupLabel.textContent = weeklyCleanupToggle.checked ? 'On':'Off';
    localStorage.setItem('qa_weekly_cleanup', weeklyCleanupToggle.checked);
  });

  // --- Init ---
  const init = async () => {
    // 0) make sure we are signed in (anonymous)
    await ensureAnonAuth();

    // 1) start realtime listener
    const unsub = startTasksListener();

    // 2) wait first snapshot (or failure), then housekeeping
    await firstSnap;
    await runDailyRollover();
    await runWeeklyCleanup();

    // 3) initial render
    if (!firestoreReady) { lsLoad(); renderCalendar(); }
    else { renderCalendar(); }

    // 4) cleanup
    window.addEventListener('beforeunload', ()=> unsub && unsub());
  };

  // start app
  init();
});
