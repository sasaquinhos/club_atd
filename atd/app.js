// GAS Web App URL - USER MUST CONFIGURE THIS
const API_URL = 'https://script.google.com/macros/s/AKfycbxF9CesTf5aHuH7X4cQ02FIke7j_VxI0JGdikXrPktiq62CkEaLYYvXuJCPkRYHJvl6WA/exec';

// App State
const state = {
  periods: [], // { id, name, startdate, enddate }
  members: [], // { id, name, affiliation, joinmonth, leavemonth }
  events: [],  // { id, title, date, time, location, note }
  attendance: {}, // { "eventId_memberId": { status, comment } }
  isAdminAuthenticated: false,
  loading: false,
  isBackgroundSyncing: false
};

const STORAGE_KEY = 'projectC_v4_data';

// DOM Elements
const loadingOverlay = document.getElementById('loading-overlay');
const periodSelect = document.getElementById('period-select');
const eventSelect = document.getElementById('event-select');
const memberSelect = document.getElementById('member-select');
const memberSelectContainer = document.getElementById('member-select-container');
const registrationInputArea = document.getElementById('registration-input-area');
const eventSummaryArea = document.getElementById('event-summary-area');
const statusPeriodSelect = document.getElementById('status-period-select');
const statusListArea = document.getElementById('status-list-area');

// Admin Elements
const adminPeriodSelect = document.getElementById('admin-period-list-select');
const adminMemberSelect = document.getElementById('admin-member-list-select');
const adminEventSelect = document.getElementById('admin-event-list-select');
const eventPeriodSelect = document.getElementById('event-period-id');

// Modal Elements
const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
const editFieldsContainer = document.getElementById('edit-fields-container');
const modalTitle = document.getElementById('modal-title');

let currentEditingType = null;
let currentEditingId = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function init() {
  // 1. Try to load from local storage first (Stale-While-Revalidate)
  const hasLocalData = loadFromLocal();

  if (hasLocalData) {
    renderAllWithPeriod();
    setLoading(false); // Hide loading immediately if we have cached data
  } else {
    // If no local data, we must show loading and wait
    setLoading(true);
  }

  // 2. Background sync from server
  state.isBackgroundSyncing = true;
  try {
    const success = await loadDataFromServer();
    if (success) {
      renderAllWithPeriod();
    }
  } catch (err) {
    console.error('Background sync failed:', err);
  } finally {
    state.isBackgroundSyncing = false;
    setLoading(false);
  }

  // Modal Submit
  if (editForm) {
    editForm.onsubmit = async (e) => {
      e.preventDefault();
      await saveEditMaster();
    };
  }

  // Admin Password Enter Key
  const adminPwdInput = document.getElementById('admin-password');
  if (adminPwdInput) {
    adminPwdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') checkAdminPassword();
    });
  }
}

function renderAllWithPeriod() {
  const today = getTodayStr();
  const curPeriod = state.periods.find(p => today >= p.startdate && today <= p.enddate);

  renderRegistrationUI();
  renderStatusUI();
  renderAdminUI();

  if (curPeriod) {
    if (periodSelect && !periodSelect.value) {
      periodSelect.value = curPeriod.id;
      updateEventSelect(curPeriod.id);
    }
    if (statusPeriodSelect && !statusPeriodSelect.value) {
      statusPeriodSelect.value = curPeriod.id;
      renderStatusUI();
    }

    const periodEvents = state.events.filter(e => e.date >= curPeriod.startdate && e.date <= curPeriod.enddate);
    if (periodEvents.length > 0 && !eventSelect.value) {
      let targetDate = '';
      const futureEvents = periodEvents.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      if (futureEvents.length > 0) targetDate = futureEvents[0].date;
      else {
        const pastEvents = periodEvents.filter(e => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
        if (pastEvents.length > 0) targetDate = pastEvents[0].date;
      }

      if (targetDate) {
        const targetEvents = periodEvents.filter(e => e.date === targetDate);
        if (targetEvents.length === 1) eventSelect.value = targetEvents[0].id;
        renderAutoDetectedEvents(targetEvents);
      }
    }
  }
}

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isMemberActiveAt(member, dateStr) {
  if (!member || !dateStr) return false;
  const targetMonth = dateStr.substring(0, 7); // YYYY-MM
  const join = member.joinmonth ? String(member.joinmonth).substring(0, 7) : null;
  const leave = member.leavemonth ? String(member.leavemonth).substring(0, 7) : null;

  if (join && targetMonth < join) return false;
  if (leave && targetMonth > leave) return false;
  return true;
}

async function apiCall(action, data = {}) {
  if (!API_URL || API_URL === 'YOUR_GAS_WEB_APP_URL_HERE') {
    console.warn('API_URL is not configured.');
    return { result: 'error', error: 'API URL not configured' };
  }
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, ...data })
    });
    return await response.json();
  } catch (err) {
    console.error('API Call failed:', err);
    return { result: 'error', error: err.toString() };
  }
}

async function loadDataFromServer() {
  const res = await apiCall('get_initial_data');
  if (res.result === 'success') {
    state.periods = res.data.periods || [];
    state.members = res.data.members || [];
    state.events = res.data.events || [];
    state.attendance = res.data.attendance || {};
    saveToLocal();
    return true;
  }
  return false;
}

function loadFromLocal() {
  try {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
      const parsed = JSON.parse(savedData);
      // Migration: convert old property names to lowercase
      state.periods = (parsed.periods || []).map(p => ({
        ...p,
        startdate: p.startdate || p.startDate,
        enddate: p.enddate || p.endDate
      }));
      state.members = (parsed.members || []).map(m => ({
        ...m,
        joinmonth: m.joinmonth || m.joinMonth,
        leavemonth: m.leavemonth || m.leaveMonth
      }));
      state.events = parsed.events || [];
      state.attendance = parsed.attendance || {};
      return true;
    }
  } catch (e) {
    console.error('Failed to load from local storage', e);
  }
  return false;
}

function saveToLocal() {
  try {
    const dataToSave = {
      periods: state.periods,
      members: state.members,
      events: state.events,
      attendance: state.attendance
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
  } catch (e) {
    console.error('Failed to save to local storage', e);
  }
}

function setLoading(isLoading) {
  state.loading = isLoading;
  if (loadingOverlay) loadingOverlay.style.display = isLoading ? 'flex' : 'none';
}

// UI Functions
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  const btn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
  if (btn) btn.classList.add('active');

  // Admin access control
  if (tabId === 'admin') {
    renderAdminAccess();
  }

  renderAll();
}

function renderAdminAccess() {
  const authArea = document.getElementById('admin-auth-area');
  const adminContent = document.getElementById('admin-content');
  if (state.isAdminAuthenticated) {
    authArea.style.display = 'none';
    adminContent.style.display = 'block';
  } else {
    authArea.style.display = 'block';
    adminContent.style.display = 'none';
    const passwordInput = document.getElementById('admin-password');
    if (passwordInput) {
      setTimeout(() => passwordInput.focus(), 100);
    }
  }
}

function checkAdminPassword() {
  const passwordInput = document.getElementById('admin-password');
  if (passwordInput.value === '1171') {
    state.isAdminAuthenticated = true;
    renderAdminAccess();
    renderAdminUI();
    passwordInput.value = '';
  } else {
    alert('パスワードが正しくありません。');
  }
}

function renderAll() {
  renderRegistrationUI();
  renderStatusUI();
  renderAdminUI();
}

// --- Registration Logic ---
function renderRegistrationUI() {
  if (!periodSelect) return;
  const currentPeriodId = periodSelect.value;
  periodSelect.innerHTML = '<option value="">-- 期間を選択 --</option>' +
    state.periods.map(p => `<option value="${p.id}" ${String(p.id) === String(currentPeriodId) ? 'selected' : ''}>${p.name}</option>`).join('');

  periodSelect.onchange = (e) => {
    updateEventSelect(e.target.value);
    registrationInputArea.style.display = 'none';
    eventSummaryArea.style.display = 'none';
    memberSelectContainer.style.display = 'none';
  };

  if (currentPeriodId) updateEventSelect(currentPeriodId);
}

function updateEventSelect(periodId) {
  if (!periodId) {
    eventSelect.innerHTML = '<option value="">-- 先に期間を選択してください --</option>';
    eventSelect.disabled = true;
    return;
  }
  const period = state.periods.find(p => String(p.id) === String(periodId));
  if (!period) return;
  const filteredEvents = state.events.filter(e => e.date >= period.startdate && e.date <= period.enddate)
    .sort((a, b) => {
      // Sort by date first (descending)
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      // If same date, sort by time (descending)
      return (b.time || "").localeCompare(a.time || "");
    });
  const currentEventId = eventSelect.value;
  eventSelect.innerHTML = '<option value="">-- イベントを選択 --</option>' +
    filteredEvents.map(e => `<option value="${e.id}" ${String(e.id) === String(currentEventId) ? 'selected' : ''}>${e.canceled ? '[中止] ' : ''}${formatDate(e.date)} ${e.time || ''} ${e.title}</option>`).join('');
  eventSelect.disabled = false;
  eventSelect.onchange = (e) => {
    if (e.target.value) {
      memberSelectContainer.style.display = 'block';
      renderMemberSelect([e.target.value]);
    } else {
      memberSelectContainer.style.display = 'none';
      registrationInputArea.style.display = 'none';
      eventSummaryArea.style.display = 'none';
    }
  };
  if (currentEventId && state.events.find(e => String(e.id) === String(currentEventId))) {
    if (memberSelect.value) {
      renderAttendanceInput([currentEventId]);
      renderEventSummary([currentEventId]);
    }
  }
}

function renderAutoDetectedEvents(events) {
  if (events.length === 0) return;
  memberSelectContainer.style.display = 'block';
  const eventIds = events.map(e => e.id);
  renderMemberSelect(eventIds);
}

function renderMemberSelect(eventIds) {
  const currentMemberId = memberSelect.value || localStorage.getItem('projectC_curMId') || '';
  const targetEvent = state.events.find(e => String(e.id) === String(eventIds[0]));
  const activeMembers = targetEvent ? state.members.filter(m => isMemberActiveAt(m, targetEvent.date)) : state.members;
  memberSelect.innerHTML = '<option value="">-- あなたの名前を選択 --</option>' +
    activeMembers.map(m => `<option value="${m.id}" ${String(m.id) === String(currentMemberId) ? 'selected' : ''}>${m.name}</option>`).join('');
  memberSelect.onchange = (e) => {
    if (e.target.value) {
      localStorage.setItem('projectC_curMId', e.target.value);
      renderAttendanceInput(eventIds);
      renderEventSummary(eventIds);
    } else {
      registrationInputArea.style.display = 'none';
      eventSummaryArea.style.display = 'none';
    }
  };
  if (currentMemberId && activeMembers.some(m => String(m.id) === String(currentMemberId))) {
    memberSelect.value = currentMemberId;
    renderAttendanceInput(eventIds);
    renderEventSummary(eventIds);
  } else if (currentMemberId) {
    memberSelect.value = "";
    registrationInputArea.style.display = 'none';
    eventSummaryArea.style.display = 'none';
  }
}

function renderAttendanceInput(eventIds) {
  const memberId = memberSelect.value;
  if (!eventIds || eventIds.length === 0 || !memberId) return;
  registrationInputArea.innerHTML = eventIds.map(eventId => {
    const event = state.events.find(e => String(e.id) === String(eventId));
    if (!event) return '';

    const today = getTodayStr();
    const isPast = event.date < today;

    const key = `${eventId}_${memberId}`;
    const att = state.attendance[key] || { status: '', comment: '' };
    const deadlineStr = event.deadlinedate ? `※ 回答締め切り：${formatDate(event.deadlinedate)} ${event.deadlinetime || '00:00'}` : '';

    if (isPast) {
      return ''; // Hide input card completely for past events
    }

    return `<div class="card" style="border-left: 5px solid var(--primary); margin-bottom: 1rem; ${event.canceled ? 'background: #fef2f2;' : ''}">
        <h3>${event.title} の出欠回答</h3>
        <div class="item-meta" style="margin-bottom: 0.25rem;">${formatDate(event.date)} ${event.time} @ ${event.location}</div>
        ${deadlineStr ? `<div style="color: #ef4444; font-weight: bold; font-size: 0.9rem; margin-bottom: 0.5rem;">${deadlineStr}</div>` : ''}
        ${event.canceled ? `<div style="color: #ef4444; font-weight: bold; background: white; padding: 0.5rem; border: 1px solid #ef4444; border-radius: 6px; margin-bottom: 1rem; text-align: center;">🚫 このイベントは中止になりました</div>` : ''}
        ${event.note ? `<div style="font-size: 0.85rem; background: #f0fdf4; padding: 0.5rem; border-radius: 6px; margin-bottom: 1rem; border-left: 3px solid var(--primary-dark); color: var(--text-main); white-space: pre-wrap;">${event.note}</div>` : ''}
        <div class="form-group">
          <label>ステータス</label>
          <select onchange="saveAttendanceLocal('${eventId}', '${memberId}', this.value, '${eventId}-comment')" ${event.canceled ? 'disabled' : ''}>
            <option value="" ${att.status === '' ? 'selected' : ''}>-- 選択してください --</option>
            <option value="出席" ${att.status === '出席' ? 'selected' : ''}>出席</option>
            <option value="見学" ${att.status === '見学' ? 'selected' : ''}>見学</option>
            <option value="欠席" ${att.status === '欠席' ? 'selected' : ''}>欠席</option>
            <option value="未定" ${att.status === '未定' ? 'selected' : ''}>未定</option>
          </select>
        </div>
        <div class="form-group">
          <label>コメント (任意)</label>
          <input type="text" id="${eventId}-comment" value="${att.comment}" placeholder="遅れて行きます、等" 
            onblur="saveAttendanceLocal('${eventId}', '${memberId}', null, '${eventId}-comment')" ${event.canceled ? 'disabled' : ''}>
        </div>
      </div>`;
  }).join('');
  registrationInputArea.style.display = 'block';
}

function renderEventSummary(eventIds) {
  if (!eventIds || eventIds.length === 0) return;
  eventSummaryArea.innerHTML = eventIds.map(eventId => {
    const event = state.events.find(e => String(e.id) === String(eventId));
    if (!event) return '';

    // Get all active members for this event
    const activeMembers = state.members.filter(m => isMemberActiveAt(m, event.date));

    // Get the attendance map for this event
    const atts = Object.keys(state.attendance).filter(k => k.startsWith(`${eventId}_`))
      .map(k => ({ memberId: k.split('_')[1], ...state.attendance[k] }));

    // Count by status
    const summary = {
      att: atts.filter(a => a.status === '出席').length,
      wat: atts.filter(a => a.status === '見学').length,
      abs: atts.filter(a => a.status === '欠席').length,
      pen: atts.filter(a => a.status === '未定').length,
      none: 0
    };

    // Calculate unanswered active members
    const answeredMemberIds = new Set(atts.map(a => String(a.memberId)));
    const unansweredMembers = activeMembers.filter(m => !answeredMemberIds.has(String(m.id)));
    summary.none = unansweredMembers.length;

    // Group by status for display
    const statuses = ['出席', '見学', '欠席', '未定'];
    let groupedHtml = statuses.map(status => {
      const filtered = atts.map(a => ({ m: activeMembers.find(m => String(m.id) === String(a.memberId)), ...a }))
        .filter(a => a.m && a.status === status);
      if (filtered.length === 0) return '';
      const names = filtered.map(a => `${a.m.name}${a.comment ? `<small>(${a.comment})</small>` : ''}`).join('、');
      return `<div style="padding: 0.2rem 0;"><strong>${status}</strong>: ${names}</div>`;
    }).join('');

    // Add unanswered list
    if (unansweredMembers.length > 0) {
      const unansweredNames = unansweredMembers.map(m => m.name).join('、');
      groupedHtml += `<div style="padding: 0.2rem 0; color: #ef4444;"><strong>未回答</strong>: ${unansweredNames}</div>`;
    }

    return `<div class="card">
        <div class="item-header"><h3 style="font-size: 1.1rem;">集計: ${event.title}</h3></div>
        <div class="summary-grid" style="margin-top: 0.5rem; grid-template-columns: repeat(5, 1fr);">
          <div class="summary-item"><span class="summary-label">出席</span><span class="summary-count">${summary.att}</span></div>
          <div class="summary-item"><span class="summary-label">見学</span><span class="summary-count">${summary.wat}</span></div>
          <div class="summary-item"><span class="summary-label">欠席</span><span class="summary-count">${summary.abs}</span></div>
          <div class="summary-item"><span class="summary-label">未定</span><span class="summary-count">${summary.pen}</span></div>
          <div class="summary-item" style="border-color: #fecaca;"><span class="summary-label" style="color: #ef4444;">未回答</span><span class="summary-count" style="color: #ef4444;">${summary.none}</span></div>
        </div>
        <div class="mt-1" style="font-size:0.85rem; border-top:1px solid #f1f5f9; padding-top:0.5rem;">
          ${groupedHtml || '<div style="color:#999">登録された回答はありません</div>'}
        </div>
      </div>`;
  }).join('');
  eventSummaryArea.style.display = 'block';
}

async function saveAttendanceLocal(eventId, memberId, status, commentElId) {
  const comment = document.getElementById(commentElId).value;
  const key = `${eventId}_${memberId}`;
  const current = state.attendance[key] || {};
  const newStatus = status !== null ? status : current.status;

  // Optimistic UI: Update local state and UI immediately
  state.attendance[key] = { status: newStatus, comment: comment };
  saveToLocal();

  const currentEventId = eventSelect.value;
  if (currentEventId) renderEventSummary([currentEventId]);

  // Background sync to server (no await or loading screen)
  apiCall('update_attendance', { eventId, memberId, status: newStatus, comment })
    .then(res => {
      if (res.result !== 'success') {
        console.error('Failed to sync attendance:', res.error);
        // Optionally revert local state if server fails critically
      }
    });
}

// --- Status Logic ---
function renderStatusUI() {
  if (!statusPeriodSelect) return;
  const currentPeriodId = statusPeriodSelect.value;
  statusPeriodSelect.innerHTML = '<option value="">-- 期間を選択 --</option>' +
    state.periods.map(p => `<option value="${p.id}" ${String(p.id) === String(currentPeriodId) ? 'selected' : ''}>${p.name}</option>`).join('');
  statusPeriodSelect.onchange = () => renderStatusUI();
  if (!currentPeriodId) {
    statusListArea.innerHTML = '<div class="card" style="color:#666; text-align:center;">期間を選択すると出席率が表示されます</div>';
    return;
  }
  const today = getTodayStr();
  const period = state.periods.find(p => String(p.id) === String(currentPeriodId));
  // Only include events occurring BEFORE today (or all events in the period if the user prefers, but requirement says "before today")
  const periodEvents = state.events.filter(e => e.date >= period.startdate && e.date <= period.enddate && e.date < today);
  const periodActiveMembers = state.members.filter(m => {
    // Only show if they were active at some point during this period
    const joinIdx = m.joinmonth ? String(m.joinmonth).substring(0, 7) : "0000-00";
    const leaveIdx = m.leavemonth ? String(m.leavemonth).substring(0, 7) : "9999-99";
    const periodStart = period.startdate.substring(0, 7);
    const periodEnd = period.enddate.substring(0, 7);
    if (joinIdx > periodEnd) return false;
    if (leaveIdx < periodStart) return false;
    return true;
  });
  if (periodActiveMembers.length === 0) {
    statusListArea.innerHTML = '<div class="card" style="color:#666; text-align:center;">この期間に在籍メンバーはいません</div>';
    return;
  }
  const memberStats = periodActiveMembers.map(m => {
    const memberEventsInPeriod = periodEvents.filter(e => isMemberActiveAt(m, e.date) && !e.canceled);
    const total = memberEventsInPeriod.length;
    let count = 0;
    if (total > 0) {
      memberEventsInPeriod.forEach(e => {
        const att = state.attendance[`${e.id}_${m.id}`];
        if (att && (att.status === '出席' || att.status === '見学')) count++;
      });
    }
    const isLeaver = !!m.leavemonth;
    // Determine if they joined DURING this period
    const joinMonth = m.joinmonth ? String(m.joinmonth).substring(0, 7) : "";
    const isNewJoiner = joinMonth >= period.startdate.substring(0, 7) && joinMonth <= period.enddate.substring(0, 7);

    return { name: m.name, aff: m.affiliation, count, total, rate: total > 0 ? ((count / total) * 100).toFixed(1) : "0.0", isLeaver, isNewJoiner, m };
  }).sort((a, b) => b.rate - a.rate);

  statusListArea.innerHTML = `<div class="card">
      <h3>出席率一覧 (${period.name})</h3>
      <div class="item-meta" style="margin-bottom:1rem;">在籍期間中のイベントを母数として計算</div>
      <table style="width:100%; border-collapse: collapse; font-size: 0.9rem;">
        <thead><tr style="border-bottom: 2px solid #e2e8f0; text-align: left;"><th style="padding: 0.5rem 0;">名前</th><th style="padding: 0.5rem 0;">出席/母数</th><th style="padding: 0.5rem 0; text-align: right;">率 (%)</th></tr></thead>
        <tbody>
          ${memberStats.map(s => {
    // Determine if they are "retired" (left before today or the period ends)
    const todayMonth = today.substring(0, 7);
    const leaveMonthStr = s.m.leavemonth ? String(s.m.leavemonth).substring(0, 7) : "";
    const isRetired = s.isLeaver && leaveMonthStr < todayMonth;

    let rowStyle = 'border-bottom: 1px solid #e2e8f0;';
    if (isRetired) {
      rowStyle += 'background-color: #f1f5f9; color: #64748b;';
    } else if (s.isNewJoiner) {
      rowStyle += 'background-color: #fefce8;'; // Light yellow for new joiners in this period
    } else {
      rowStyle += 'background-color: #ffffff;';
    }

    const nameStyle = isRetired ? 'font-weight:normal; color: #475569;' : 'font-weight:bold; color: var(--text-main);';
    const rateStyle = isRetired ? 'color: #94a3b8;' : 'color:var(--primary);';

    return `<tr style="${rowStyle}">
              <td style="padding: 0.75rem 0.5rem;">
                <div style="${nameStyle}">${s.name}${isRetired ? ` <span style="font-size:0.7rem; background:#cbd5e1; color:#475569; padding:1px 4px; border-radius:3px; margin-left:4px;">${leaveMonthStr}退会</span>` : ''}${s.isNewJoiner && !isRetired ? ' <span style="font-size:0.7rem; background:#fde68a; color:#92400e; padding:1px 4px; border-radius:3px; margin-left:4px;">新入会</span>' : ''}</div>
                <div style="font-size:0.75rem; color:inherit; opacity: 0.8;">${s.aff || '-'}</div>
              </td>
              <td style="padding: 0.75rem 0; opacity: ${isRetired ? '0.7' : '1'};">${s.count} / ${s.total}</td>
              <td style="padding: 0.75rem 0.5rem; text-align: right; ${nameStyle} ${rateStyle} font-size:1.1rem;">${s.rate}%</td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>
    </div>`;
}

// --- Admin Logic ---
function renderAdminUI() {
  if (adminPeriodSelect) {
    adminPeriodSelect.innerHTML = '<option value="">-- 期間を選択 --</option>' +
      state.periods.map(p => `<option value="${p.id}">${p.name} (${p.startdate} 〜 ${p.enddate})</option>`).join('');
  }
  if (eventPeriodSelect) {
    eventPeriodSelect.innerHTML = '<option value="">-- 期間を選択 --</option>' +
      state.periods.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }
  if (adminMemberSelect) {
    adminMemberSelect.innerHTML = '<option value="">-- メンバーを選択 --</option>' +
      state.members.map(m => `<option value="${m.id}">${m.name}${m.affiliation ? ` (${m.affiliation})` : ''}</option>`).join('');
  }
  if (adminEventSelect) {
    adminEventSelect.innerHTML = '<option value="">-- イベントを選択 --</option>' +
      [...state.events].sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.time || "").localeCompare(a.time || "");
      })
        .map(e => `<option value="${e.id}">${e.canceled ? '[中止] ' : ''}${formatDate(e.date)} ${e.time || ''} ${e.title} @ ${e.location}</option>`).join('');
  }
}

async function handleAdminAction(type, action) {
  let selectEl;
  if (type === 'period') selectEl = adminPeriodSelect;
  else if (type === 'member') selectEl = adminMemberSelect;
  else if (type === 'event') selectEl = adminEventSelect;
  const id = selectEl ? selectEl.value : null;
  if (!id) { alert('対象を選択してください'); return; }
  if (action === 'edit') editMaster(type, id);
  else if (action === 'delete') await deleteMaster(type, id);
}

function editMaster(type, id) {
  currentEditingType = type;
  currentEditingId = id;
  let title = "編集";
  let fieldsHtml = "";

  if (type === 'period') {
    const p = state.periods.find(x => String(x.id) === String(id));
    title = "期間を編集";
    fieldsHtml = `
      <div class="form-group"><label>期間名</label><input type="text" id="edit-period-name" value="${p.name}" required></div>
      <div class="form-row">
        <div class="form-group"><label>開始日</label><input type="date" id="edit-period-start" value="${p.startdate}" required></div>
        <div class="form-group"><label>終了日</label><input type="date" id="edit-period-end" value="${p.enddate}" required></div>
      </div>`;
  } else if (type === 'member') {
    const m = state.members.find(x => String(x.id) === String(id));
    title = "メンバーを編集";
    // Ensure month values are exactly YYYY-MM for the input fields
    const joinVal = m.joinmonth ? String(m.joinmonth).substring(0, 7) : "";
    const leaveVal = m.leavemonth ? String(m.leavemonth).substring(0, 7) : "";
    fieldsHtml = `
      <div class="form-group"><label>名前</label><input type="text" id="edit-member-name" value="${m.name}" required></div>
      <div class="form-group"><label>所属(任意)</label><input type="text" id="edit-member-aff" value="${m.affiliation || ''}"></div>
      <div class="form-row">
        <div class="form-group"><label>入会月 (YYYY-MM)</label><input type="month" id="edit-member-join" value="${joinVal}"></div>
        <div class="form-group"><label>退会月 (YYYY-MM)</label><input type="month" id="edit-member-leave" value="${leaveVal}"></div>
      </div>`;
  } else if (type === 'event') {
    const e = state.events.find(x => String(x.id) === String(id));
    title = "イベントを編集";
    // Ensure time matches HH:mm for the input field
    const timeVal = e.time ? e.time.substring(0, 5) : "";
    fieldsHtml = `
      <div class="form-group"><label>タイトル</label><input type="text" id="edit-event-title" value="${e.title}" required></div>
      <div class="form-row">
        <div class="form-group"><label>日付</label><input type="date" id="edit-event-date" value="${e.date}" required></div>
        <div class="form-group"><label>時間</label><input type="time" id="edit-event-time" value="${timeVal}" required></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>回答締め切り日 (任意)</label><input type="date" id="edit-event-deadline-date" value="${e.deadlinedate || ''}"></div>
        <div class="form-group"><label>締め切り時間 (任意)</label><input type="time" id="edit-event-deadline-time" value="${e.deadlinetime || ''}"></div>
      </div>
      <div class="form-group"><label>場所</label><input type="text" id="edit-event-loc" value="${e.location}" required></div>
      <div class="form-group" style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem;">
        <input type="checkbox" id="edit-event-canceled" style="width: auto; margin: 0;" ${e.canceled ? 'checked' : ''}>
        <label for="edit-event-canceled" style="margin: 0; cursor: pointer; color: #ef4444; font-weight: bold;">このイベントを中止にする</label>
      </div>
      <div class="form-group"><label>メモ (任意)</label><textarea id="edit-event-note" rows="2">${e.note || ''}</textarea></div>`;
  }

  modalTitle.innerText = title;
  editFieldsContainer.innerHTML = fieldsHtml;
  editModal.classList.add('active');
}

async function saveEditMaster() {
  const type = currentEditingType;
  const id = currentEditingId;
  let payload = { id };

  if (type === 'period') {
    const p = state.periods.find(x => String(x.id) === String(id));
    p.name = document.getElementById('edit-period-name').value;
    p.startdate = document.getElementById('edit-period-start').value;
    p.enddate = document.getElementById('edit-period-end').value;
    payload = { ...payload, name: p.name, startDate: p.startdate, endDate: p.enddate };
  } else if (type === 'member') {
    const m = state.members.find(x => String(x.id) === String(id));
    m.name = document.getElementById('edit-member-name').value;
    m.affiliation = document.getElementById('edit-member-aff').value;
    m.joinmonth = document.getElementById('edit-member-join').value;
    m.leavemonth = document.getElementById('edit-member-leave').value;
    payload = { ...payload, name: m.name, affiliation: m.affiliation, joinMonth: m.joinmonth, leaveMonth: m.leavemonth };
  } else if (type === 'event') {
    const e = state.events.find(x => String(x.id) === String(id));
    e.title = document.getElementById('edit-event-title').value;
    e.date = document.getElementById('edit-event-date').value;
    e.time = document.getElementById('edit-event-time').value;
    e.location = document.getElementById('edit-event-loc').value;
    e.note = document.getElementById('edit-event-note').value;
    e.deadlinedate = document.getElementById('edit-event-deadline-date').value;
    e.deadlinetime = document.getElementById('edit-event-deadline-time').value;
    e.canceled = document.getElementById('edit-event-canceled').checked;
    payload = { ...payload, title: e.title, date: e.date, time: e.time, location: e.location, note: e.note, deadlineDate: e.deadlinedate, deadlineTime: e.deadlinetime, canceled: e.canceled };
  }

  setLoading(true);
  const res = await apiCall(`update_${type}`, payload);
  if (res.result === 'success') {
    saveToLocal();
    renderAll();
  } else {
    alert('更新に失敗しました: ' + res.error);
  }
  setLoading(false);
  closeModal();
}

function closeModal() {
  editModal.classList.remove('active');
  currentEditingType = null;
  currentEditingId = null;
}

async function deleteMaster(type, id) {
  if (!confirm('本当に削除しますか？関連するデータも削除されます。')) return;
  setLoading(true);
  const res = await apiCall(`delete_${type}`, { id });
  if (res.result === 'success') {
    if (type === 'period') state.periods = state.periods.filter(x => String(x.id) !== String(id));
    else if (type === 'member') state.members = state.members.filter(x => String(x.id) !== String(id));
    else if (type === 'event') state.events = state.events.filter(x => String(x.id) !== String(id));
    saveToLocal();
    renderAll();
  } else {
    alert('削除に失敗しました: ' + res.error);
  }
  setLoading(false);
}

// Master Forms
const addPeriodForm = document.getElementById('add-period-form');
if (addPeriodForm) {
  addPeriodForm.onsubmit = async (e) => {
    e.preventDefault();
    const id = 'p-' + Date.now();
    const payload = { id, name: document.getElementById('period-name').value, startDate: document.getElementById('period-start').value, endDate: document.getElementById('period-end').value };
    setLoading(true);
    const res = await apiCall('add_period', payload);
    if (res.result === 'success') {
      state.periods.push({ id, name: payload.name, startdate: payload.startDate, enddate: payload.endDate });
      saveToLocal();
      addPeriodForm.reset();
      renderAll();
    } else {
      alert('追加に失敗しました: ' + res.error);
    }
    setLoading(false);
  };
}
const addMemberForm = document.getElementById('add-member-form');
if (addMemberForm) {
  addMemberForm.onsubmit = async (e) => {
    e.preventDefault();
    const id = 'm-' + Date.now();
    const payload = { id, name: document.getElementById('member-name').value, affiliation: document.getElementById('member-affiliation').value, joinMonth: '', leaveMonth: '' };
    setLoading(true);
    const res = await apiCall('add_member', payload);
    if (res.result === 'success') {
      state.members.push({ id, name: payload.name, affiliation: payload.affiliation, joinmonth: '', leavemonth: '' });
      saveToLocal();
      addMemberForm.reset();
      renderAll();
    } else {
      alert('追加に失敗しました: ' + res.error);
    }
    setLoading(false);
  };
}
const addEventForm = document.getElementById('add-event-form');
if (addEventForm) {
  addEventForm.onsubmit = async (e) => {
    e.preventDefault();
    const id = 'e-' + Date.now();
    const payload = {
      id,
      title: document.getElementById('event-title').value,
      date: document.getElementById('event-date').value,
      time: document.getElementById('event-time').value,
      location: document.getElementById('event-location').value,
      note: document.getElementById('event-note').value,
      deadlineDate: document.getElementById('event-deadline-date').value,
      deadlineTime: document.getElementById('event-deadline-time').value,
      canceled: false
    };
    setLoading(true);
    const res = await apiCall('add_event', payload);
    if (res.result === 'success') {
      state.events.push({
        id,
        title: payload.title,
        date: payload.date,
        time: payload.time,
        location: payload.location,
        note: payload.note,
        deadlinedate: payload.deadlineDate,
        deadlinetime: payload.deadlineTime,
        canceled: payload.canceled
      });
      saveToLocal();
      addEventForm.reset();
      renderAll();
    } else {
      alert('追加に失敗しました: ' + res.error);
    }
    setLoading(false);
  };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}
