// script.js — Your original app + Firestore + Anonymous Auth (with safe fallback)

// ---------- Firebase (CDN ESM) ----------
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, setDoc, getDoc
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

// ---- Init Firebase ----
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db  = getFirestore(app);

// ---- Auth helper (never hangs) ----
function ensureAnonAuth() {
  return new Promise((resolve) => {
    let done = false;
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user && !done) { done = true; try{unsub();}catch{} resolve(user); }
    });
    signInAnonymously(auth).catch((err)=>console.warn('Anonymous sign-in failed:', err));
    setTimeout(()=>{ if(!done){ done = true; try{unsub();}catch{} resolve(null); }}, 2000);
  });
}

// ---- Server time helper (for weekly cleanup) ----
async function getServerNow() {
  try {
    const ref = doc(db, '_meta', 'server-time');
    await setDoc(ref, { now: serverTimestamp() }, { merge: true });
    const snap = await getDoc(ref);
    const ts = snap.data()?.now;
    return ts?.toDate ? ts.toDate() : new Date();
  } catch { return new Date(); }
}

// ---- ID helper (replaces uuid.v4) ----
const genId = () => (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

// =====================================================================
// ======================= ORIGINAL APP (ENHANCED) =====================
// =====================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // --- STATE MANAGEMENT ---
  let tasks = [];
  let currentViewDate = new Date();
  let selectedDate = new Date();
  let currentEditingTaskId = null;

  // Firestore wiring state
  let firestoreReady = false;
  let unsubscribeFS = null;

  // --- CONSTANTS & DEFAULTS ---
  const DEPARTMENTS = {
    QA: 'var(--dept-qa)',
    DEV: 'var(--dept-dev)',
    Productio: 'var(--dept-productio)',
    QC: 'var(--dept-qc)',
    Other: 'var(--dept-other)'
  };
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // --- DOM ELEMENT CACHING ---
  const mainContent = document.getElementById('app-main-content');
  const navLinks = document.querySelectorAll('.nav-link');
  const views = document.querySelectorAll('.view');
  // Calendar
  const calendarGrid = document.getElementById('calendar-grid');
  const calendarWeekdays = document.getElementById('calendar-weekdays');
  const monthYearHeader = document.getElementById('month-year-header');
  const prevMonthBtn = document.getElementById('prev-month-btn');
  const nextMonthBtn = document.getElementById('next-month-btn');
  const todayBtn = document.getElementById('today-btn');
  const addTaskForDateBtn = document.getElementById('add-task-for-date-btn');
  // Tasks view
  const todayTasksContainer = document.getElementById('today-tasks');
  const tomorrowTasksContainer = document.getElementById('tomorrow-tasks');
  const alertsTasksContainer = document.getElementById('alerts-tasks');
  // Reports view
  const reportsTableBody = document.getElementById('reports-table-body');
  const reportDateFilter = document.getElementById('report-date-filter');
  const exportPdfBtn = document.getElementById('export-pdf-btn');
  const weeklyCleanupToggle = document.getElementById('weekly-cleanup-toggle');
  const weeklyCleanupLabel = document.getElementById('weekly-cleanup-label');
  // Task Modal
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
  // Confirm Modal
  const confirmModal = document.getElementById('confirm-modal');
  const confirmModalTitle = document.getElementById('confirm-modal-title');
  const confirmModalBody = document.getElementById('confirm-modal-body');
  const confirmModalInput = document.getElementById('confirm-modal-input');
  const confirmModalConfirmBtn = document.getElementById('confirm-modal-confirm-btn');
  const confirmModalCancelBtn = document.getElementById('confirm-modal-cancel-btn');

  // --- UTILITY FUNCTIONS ---
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const formatTime = (date) => date.toTimeString().slice(0, 5);
  const showToast = (message, type = 'info', duration = 3000) => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };
  const getPriority = () => document.querySelector('input[name="priority"]:checked').value;
  const setPriority = (priority) => {
    const radio = document.querySelector(`input[name="priority"][value="${priority}"]`);
    if (radio) radio.checked = true;
  };

  // --- DATA PERSISTENCE (localStorage) ---
  const saveTasks = () => localStorage.setItem('qa_tasks', JSON.stringify(tasks));
  const loadTasks = () => {
    const storedTasks = localStorage.getItem('qa_tasks');
    tasks = storedTasks ? JSON.parse(storedTasks) : [];
  };
  const saveWeeklyCleanupSetting = () => localStorage.setItem('qa_weekly_cleanup', weeklyCleanupToggle.checked);
  const loadWeeklyCleanupSetting = () => {
    const setting = localStorage.getItem('qa_weekly_cleanup') === 'true';
    weeklyCleanupToggle.checked = setting;
    weeklyCleanupLabel.textContent = setting ? 'On' : 'Off';
  };

  // ==================== Firestore Bridge (drop-in) ====================
  function startTasksListener() {
    try {
      const q = query(collection(db, 'tasks'), orderBy('date'), orderBy('createdAt'));
      unsubscribeFS = onSnapshot(q, (snap) => {
        firestoreReady = true;
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
        renderCurrentView();
      }, (err) => {
        console.warn('Firestore listener error, using localStorage fallback:', err);
        firestoreReady = false;
        if (!tasks.length) { loadTasks(); renderCurrentView(); }
      });
    } catch (e) {
      console.warn('Firestore listener setup failed:', e);
      firestoreReady = false;
      loadTasks(); renderCurrentView();
    }
  }

  async function createTaskFS(data) {
    if (!firestoreReady) throw new Error('fs-not-ready');
    const ref = await addDoc(collection(db, 'tasks'), {
      ...data,
      status: data.status || 'in_progress',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      doneAt: null
    });
    return ref.id;
  }
  async function updateTaskFS(id, updates) {
    if (!firestoreReady) throw new Error('fs-not-ready');
    await updateDoc(doc(db, 'tasks', id), { ...updates, updatedAt: serverTimestamp() });
  }
  async function deleteTaskFS(id) {
    if (!firestoreReady) throw new Error('fs-not-ready');
    await deleteDoc(doc(db, 'tasks', id));
  }

  // --- CORE LOGIC: Daily Rollover & Cleanup ---
  const runDailyRollover = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let changesMade = false;

    tasks.forEach(task => {
      const taskDate = new Date(task.date + 'T00:00:00');
      const hasOpenSubs = Array.isArray(task.subtasks) && task.subtasks.some(st=>!st.done);
      if ((task.status !== 'done' || hasOpenSubs) && taskDate < today) {
        task.date = formatDate(today);
        task.status = 'delayed';
        task.delayedSince = formatDate(today);
        changesMade = true;
      }
    });

    if (changesMade) {
      showToast(`Overdue tasks moved to today.`);
      if (!firestoreReady) saveTasks(); // When FS is on, listener will reflect updates after manual updates below
    }
  };

  const runWeeklyCleanup = async () => {
    if (!weeklyCleanupToggle.checked) return;
    const now = firestoreReady ? await getServerNow() : new Date();
    if (now.getDay() === 0) {
      const todayKey = formatDate(now);
      if (localStorage.getItem('qa_last_cleanup') === todayKey) return;

      const sevenAgo = new Date(now); sevenAgo.setDate(now.getDate() - 7);
      const toDelete = tasks.filter(t => t.status === 'done' && t.doneAt && new Date(t.doneAt) <= sevenAgo);

      if (toDelete.length) {
        // If FS available try delete there; otherwise local
        if (firestoreReady) {
          for (const t of toDelete) {
            try { await deleteTaskFS(t.id); } catch(e){ console.warn('FS delete failed, will fall back local:', e); }
          }
        }
        const originalLen = tasks.length;
        tasks = tasks.filter(t => !(t.status === 'done' && t.doneAt && new Date(t.doneAt) <= sevenAgo));
        if (!firestoreReady) { saveTasks(); renderCurrentView(); }
        showToast(`${originalLen - tasks.length} old 'Done' tasks cleared.`, 'success');
      }
      localStorage.setItem('qa_last_cleanup', todayKey);
    }
  };

  // --- RENDERING FUNCTIONS ---
  const renderCurrentView = () => {
    const activeLink = document.querySelector('.nav-link.active');
    if (!activeLink) return;
    const viewName = activeLink.dataset.view;
    switch (viewName) {
      case 'calendar': renderCalendar(); break;
      case 'tasks': renderTasksView(); break;
      case 'reports': renderReportsView(); break;
    }
  };

  const renderCalendar = () => {
    monthYearHeader.textContent = currentViewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const month = currentViewDate.getMonth();
    const year = currentViewDate.getFullYear();
    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDayOfWeek = firstDayOfMonth.getDay();

    calendarGrid.innerHTML = '';
    if (calendarWeekdays.children.length === 0) {
      WEEKDAYS.forEach(day => calendarWeekdays.innerHTML += `<div>${day}</div>`);
    }
    for (let i = 0; i < startDayOfWeek; i++) {
      calendarGrid.innerHTML += `<div class="calendar-day other-month"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = formatDate(date);
      const cell = document.createElement('div');
      cell.className = 'calendar-day';
      cell.dataset.date = dateStr;

      const dayNumber = document.createElement('span');
      dayNumber.className = 'day-number';
      dayNumber.textContent = day;
      if (dateStr === formatDate(new Date())) dayNumber.classList.add('today');
      if (dateStr === formatDate(selectedDate)) cell.classList.add('selected');
      cell.appendChild(dayNumber);

      tasks.filter(t => t.date === dateStr).forEach(task => {
        const taskBar = document.createElement('div');
        taskBar.className = 'task-bar';
        taskBar.style.backgroundColor = DEPARTMENTS[task.department] || 'var(--dept-other)';
        taskBar.dataset.taskId = task.id;

        let badges = '';
        if (task.priority === 'urgent') badges += '<span>⚠ </span>';
        if (task.important) badges += '<span>★ </span>';
        if (task.status === 'delayed') badges += '<span>Delayed </span>';

        let subtaskCounter = '';
        if (task.subtasks && task.subtasks.length > 0) {
          const doneCount = task.subtasks.filter(st => st.done).length;
          subtaskCounter = `<span class="subtask-counter">${doneCount}/${task.subtasks.length}</span>`;
        }

        taskBar.innerHTML = `<div class="task-bar-content"><span class="badges">${badges}</span>${task.title}${subtaskCounter}</div>`;
        taskBar.title = `Title: ${task.title}\nDepartment: ${task.department || 'N/A'}\nPriority: ${task.priority}\nStatus: ${task.status.replace('_', ' ')}`;
        cell.appendChild(taskBar);
      });
      calendarGrid.appendChild(cell);
    }
  };

  const renderTasksView = () => {
    const todayStr = formatDate(new Date());
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDate(tomorrow);

    const todayTasks = tasks.filter(t => t.date === todayStr);
    const tomorrowTasks = tasks.filter(t => t.date === tomorrowStr);
    const alertTasks = tasks.filter(t => t.important || t.status === 'delayed' || (t.reminderAt && new Date(t.reminderAt) > new Date()));

    const createTaskItemHTML = (task) => {
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
            ${task.department ? `<span class="chip" style="background-color: ${DEPARTMENTS[task.department] || 'var(--dept-other)'}">${task.department}</span>` : ''}
            <span class="priority-badge priority-${task.priority}">${task.priority}</span>
            <span class="status-badge status-${task.status.replace('_','')}">${task.status.replace('_', ' ')}</span>
            ${task.important ? '<span class="status-important">★ Important</span>' : ''}
            ${task.assignee ? `<span>${task.assignee}</span>` : ''}
            ${reminderText}
          </div>
        </div>`;
    };

    todayTasksContainer.innerHTML = `<h3>Today — ${todayStr} <button class="btn-text add-task-btn" data-date="${todayStr}">+ Add Task</button></h3>`;
    todayTasksContainer.innerHTML += todayTasks.length > 0 ? todayTasks.map(createTaskItemHTML).join('') : '<p>No tasks scheduled.</p>';

    tomorrowTasksContainer.innerHTML = `<h3>Tomorrow — ${tomorrowStr} <button class="btn-text add-task-btn" data-date="${tomorrowStr}">+ Add Task</button></h3>`;
    tomorrowTasksContainer.innerHTML += tomorrowTasks.length > 0 ? tomorrowTasks.map(createTaskItemHTML).join('') : '<p>No tasks scheduled.</p>';

    alertsTasksContainer.innerHTML = `<h3>Alerts</h3>`;
    alertsTasksContainer.innerHTML += alertTasks.length > 0 ? alertTasks.map(createTaskItemHTML).join('') : '<p>No alerts.</p>';
  };

  const renderReportsView = () => {
    const filterValue = reportDateFilter.value;
    const now = new Date();
    let startDate;
    if (filterValue !== 'all') {
      startDate = new Date(); startDate.setDate(now.getDate() - parseInt(filterValue));
    }

    const doneTasks = tasks.filter(t => {
      if (t.status !== 'done' || !t.doneAt) return false;
      if (filterValue === 'all') return true;
      return new Date(t.doneAt) >= startDate;
    }).sort((a,b) => new Date(b.doneAt) - new Date(a.doneAt));

    reportsTableBody.innerHTML = doneTasks.map(task => `
      <tr>
        <td>${task.date}</td>
        <td>${task.title}</td>
        <td>${task.department || ''}</td>
        <td>${task.assignee || ''}</td>
        <td>${task.priority}</td>
        <td>${new Date(task.doneAt).toLocaleString()}</td>
        <td>${task.notes || ''}</td>
      </tr>
    `).join('');
  };

  // --- MODAL HANDLING ---
  const openModal = (mode, taskId = null) => {
    taskForm.reset();
    currentEditingTaskId = taskId;

    subtasksList.innerHTML = '';
    setPriority('general');
    reminderFields.style.display = 'none';
    editModalHeaderActions.innerHTML = '';

    if (mode === 'new') {
      modalTitle.textContent = 'New Task';
      saveTaskBtn.textContent = 'Save Task';
      statusFormGroup.style.display = 'none';
      taskDateInput.value = formatDate(selectedDate);
    } else {
      modalTitle.textContent = 'Edit Task';
      saveTaskBtn.textContent = 'Update Task';
      statusFormGroup.style.display = 'block';
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        taskIdInput.value = task.id;
        taskTitleInput.value = task.title;
        taskDateInput.value = task.date;
        taskEtaInput.value = task.etaDate || '';
        setPriority(task.priority);
        taskImportantCheckbox.checked = task.important;
        taskStatusSelect.value = task.status;
        taskDepartmentSelect.value = task.department || '';
        taskAssigneeInput.value = task.assignee || '';
        taskNotesInput.value = task.notes || '';

        if (task.reminderAt) {
          taskReminderToggle.checked = true;
          reminderFields.style.display = 'flex';
          const rd = new Date(task.reminderAt);
          taskReminderDate.value = formatDate(rd);
          taskReminderTime.value = rd.toTimeString().slice(0,5);
        }

        (task.subtasks || []).forEach(st => addSubtaskToDOM(st.id, st.text, st.done));
        updateSubtaskProgress(task.id);
        setupEditHeaderActions(task.id);
      }
    }

    taskModal.classList.add('active');
    validateTaskForm();
  };

  const closeModal = () => {
    taskModal.classList.remove('active');
    confirmModal.classList.remove('active');
  };

  const setupEditHeaderActions = (taskId) => {
    editModalHeaderActions.innerHTML = `
      <button type="button" class="btn btn-secondary" data-action="done">Mark Done</button>
      <button type="button" class="btn btn-secondary" data-action="in_progress">Mark In Progress</button>
      <button type="button" class="btn btn-danger" data-action="delete">Delete</button>
    `;
    editModalHeaderActions.querySelector('[data-action="done"]').onclick = () => handleStatusChange(taskId, 'done');
    editModalHeaderActions.querySelector('[data-action="in_progress"]').onclick = () => handleStatusChange(taskId, 'in_progress');
    editModalHeaderActions.querySelector('[data-action="delete"]').onclick = () => confirmDeleteTask(taskId);
  };

  const addSubtaskToDOM = (id, text = '', done = false) => {
    const subtaskId = id || `subtask_${genId()}`;
    const li = document.createElement('li');
    li.className = 'subtask-item';
    li.dataset.subtaskId = subtaskId;
    li.innerHTML = `
      <input type="checkbox" ${done ? 'checked' : ''}>
      <input type="text" class="form-control" placeholder="Describe a subtask…" value="${text}">
      <button type="button" class="remove-subtask-btn">🗑️</button>
    `;
    subtasksList.appendChild(li);
    li.querySelector('.remove-subtask-btn').onclick = () => li.remove();
  };

  const updateSubtaskProgress = (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks || task.subtasks.length === 0) {
      subtaskProgressLabel.textContent = '';
      return;
    }
    const doneCount = task.subtasks.filter(st => st.done).length;
    subtaskProgressLabel.textContent = `(${doneCount}/${task.subtasks.length})`;
  };

  // --- ACTION HANDLERS (now DB-aware) ---
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

    const taskData = {
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

    try {
      if (currentEditingTaskId) {
        // update
        if (firestoreReady) {
          await updateTaskFS(currentEditingTaskId, { ...taskData, status: taskStatusSelect.value });
        } else {
          const idx = tasks.findIndex(t => t.id === currentEditingTaskId);
          if (idx > -1) tasks[idx] = { ...tasks[idx], ...taskData, status: taskStatusSelect.value, updatedAt: new Date().toISOString() };
          saveTasks();
        }
        showToast('Task updated.', 'success');
      } else {
        // create
        if (firestoreReady) {
          const id = await createTaskFS({ ...taskData, status: 'in_progress' });
          // Optimistic local append not required; onSnapshot will render. But if you want instant:
          // tasks.push({ ...taskData, id, status:'in_progress' });
        } else {
          tasks.push({ ...taskData, id: genId(), status: 'in_progress', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          saveTasks();
        }
        showToast('Task created.', 'success');
      }
      closeModal();
      renderCurrentView();
    } catch (e) {
      console.warn('Save via Firestore failed, falling back to local:', e);
      if (currentEditingTaskId) {
        const idx = tasks.findIndex(t => t.id === currentEditingTaskId);
        if (idx > -1) tasks[idx] = { ...tasks[idx], ...taskData, status: taskStatusSelect.value, updatedAt: new Date().toISOString() };
      } else {
        tasks.push({ ...taskData, id: genId(), status:'in_progress', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
      saveTasks();
      closeModal();
      renderCurrentView();
    }
  };

  const handleStatusChange = async (taskId, newStatus) => {
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const task = tasks[taskIndex];
    if (newStatus === 'done') {
      const hasUnchecked = (task.subtasks || []).some(st => !st.done);
      if (hasUnchecked) {
        showConfirmation('Unchecked Subtasks', 'There are unchecked subtasks. Mark them all as done?', async () => {
          const subs = (task.subtasks || []).map(s => ({...s, done:true}));
          await finalizeStatusChange(taskIndex, 'done', subs);
        });
        return;
      }
    }
    await finalizeStatusChange(taskIndex, newStatus);
  };

  const finalizeStatusChange = async (taskIndex, newStatus, newSubs=null) => {
    const id = tasks[taskIndex].id;
    const updates = {
      status: newStatus,
      ...(newStatus === 'done' ? { doneAt: new Date().toISOString() } : {}),
      ...(newSubs ? { subtasks: newSubs } : {})
    };

    try {
      if (firestoreReady) {
        await updateTaskFS(id, {
          ...updates,
          ...(newStatus === 'done' ? { doneAt: serverTimestamp() } : {})
        });
      } else {
        tasks[taskIndex] = { ...tasks[taskIndex], ...updates, updatedAt: new Date().toISOString() };
        saveTasks();
      }
      showToast(`Task marked as ${newStatus.replace('_', ' ')}.`, 'success');
      closeModal();
      renderCurrentView();
    } catch (e) {
      console.warn('Status update via FS failed, falling back local:', e);
      tasks[taskIndex] = { ...tasks[taskIndex], ...updates, updatedAt: new Date().toISOString() };
      saveTasks();
      showToast(`Task marked as ${newStatus.replace('_', ' ')}.`, 'success');
      closeModal();
      renderCurrentView();
    }
  };

  const confirmDeleteTask = (taskId) => {
    showConfirmation(
      'Delete task?', 'This action cannot be undone. Type DELETE to confirm.',
      async (inputValue) => {
        if (inputValue === 'DELETE') {
          try {
            if (firestoreReady) await deleteTaskFS(taskId);
            tasks = tasks.filter(t => t.id !== taskId);
            if (!firestoreReady) saveTasks();
            showToast('Task deleted.', 'info');
            closeModal();
            renderCurrentView();
          } catch (e) {
            console.warn('Delete via FS failed, falling back local:', e);
            tasks = tasks.filter(t => t.id !== taskId);
            saveTasks();
            showToast('Task deleted.', 'info');
            closeModal();
            renderCurrentView();
          }
        } else {
          showToast('Deletion cancelled. Incorrect confirmation text.', 'error');
        }
      }, true
    );
  };

  const showConfirmation = (title, body, onConfirm, requireInput = false) => {
    confirmModalTitle.textContent = title;
    confirmModalBody.textContent = body;
    confirmModalInput.style.display = requireInput ? 'block' : 'none';
    confirmModalInput.value = '';

    const confirmHandler = () => {
      onConfirm(requireInput ? confirmModalInput.value : true);
      confirmModal.classList.remove('active');
      confirmModalConfirmBtn.removeEventListener('click', confirmHandler);
    };

    confirmModalConfirmBtn.addEventListener('click', confirmHandler);
    confirmModal.classList.add('active');
  };

  const validateTaskForm = () => {
    let isValid = true;
    if (!taskTitleInput.value.trim()) isValid = false;
    if (!document.querySelector('input[name="priority"]:checked')) isValid = false;
    if (taskReminderToggle.checked) {
      const reminderDateTime = new Date(`${taskReminderDate.value}T${taskReminderTime.value}`);
      if (!taskReminderDate.value || !taskReminderTime.value || reminderDateTime < new Date()) isValid = false;
    }
    if (taskEtaInput.value && taskDateInput.value && taskEtaInput.value < taskDateInput.value) isValid = false;

    saveTaskBtn.disabled = !isValid;
    return isValid;
  };

  // --- EVENT LISTENERS ---
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navLinks.forEach(l => l.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));
      link.classList.add('active');
      document.getElementById(link.dataset.view + '-view').classList.add('active');
      renderCurrentView();
    });
  });

  prevMonthBtn.addEventListener('click', () => { currentViewDate.setMonth(currentViewDate.getMonth() - 1); renderCalendar(); });
  nextMonthBtn.addEventListener('click', () => { currentViewDate.setMonth(currentViewDate.getMonth() + 1); renderCalendar(); });
  todayBtn.addEventListener('click', () => { currentViewDate = new Date(); selectedDate = new Date(); renderCalendar(); });
  addTaskForDateBtn.addEventListener('click', () => openModal('new'));

  calendarGrid.addEventListener('click', (e) => {
    const taskBar = e.target.closest('.task-bar');
    if (taskBar) {
      e.stopPropagation();
      openModal('edit', taskBar.dataset.taskId);
      return;
    }
    const dayCell = e.target.closest('.calendar-day');
    if (dayCell && dayCell.dataset.date) {
      selectedDate = new Date(dayCell.dataset.date + 'T00:00:00');
      renderCalendar();
    }
  });

  mainContent.addEventListener('click', e => {
    if (e.target.matches('.add-task-btn')) {
      selectedDate = new Date(e.target.dataset.date + 'T00:00:00');
      openModal('new');
    } else if (e.target.matches('.mark-done-btn')) {
      handleStatusChange(e.target.closest('.task-item').dataset.taskId, 'done');
    } else if (e.target.matches('.more-btn')) {
      openModal('edit', e.target.closest('.task-item').dataset.taskId);
    }
  });

  saveTaskBtn.addEventListener('click', handleSaveTask);
  cancelBtn.addEventListener('click', closeModal);
  confirmModalCancelBtn.addEventListener('click', () => confirmModal.classList.remove('active'));

  taskReminderToggle.addEventListener('change', () => {
    reminderFields.style.display = taskReminderToggle.checked ? 'flex' : 'none';
    if (taskReminderToggle.checked && !taskReminderDate.value) {
      taskReminderDate.value = taskDateInput.value;
      taskReminderTime.value = '09:00';
    }
  });

  addSubtaskBtn.addEventListener('click', () => addSubtaskToDOM());
  taskForm.addEventListener('input', validateTaskForm);

  reportDateFilter.addEventListener('change', renderReportsView);
  exportPdfBtn.addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.autoTable({
      html: '#reports-table', startY: 20,
      headStyles: { fillColor: [41, 128, 185] },
      didDrawPage: data => doc.text("Done Task Report", data.settings.margin.left, 15)
    });
    doc.save('qa-done-tasks-report.pdf');
    showToast('PDF exported.', 'success');
  });

  weeklyCleanupToggle.addEventListener('change', () => {
    weeklyCleanupLabel.textContent = weeklyCleanupToggle.checked ? 'On' : 'Off';
    saveWeeklyCleanupSetting();
  });

  // --- INITIALIZATION ---
  const init = async () => {
    // local state first (fast UI)
    loadTasks();
    loadWeeklyCleanupSetting();
    selectedDate = new Date();
    renderCalendar();

    // Auth + Firestore live sync
    await ensureAnonAuth();
    startTasksListener(); // if this fails we keep local-only

    runDailyRollover();
    await runWeeklyCleanup();

    // If FS is off, we already rendered from local; if FS is on, onSnapshot will re-render.
  };

  await init();
});
