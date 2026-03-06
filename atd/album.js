// GAS Web App URL
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxNSFpoy5Wtoa0Lu8kceV4oiQcRPC9T4XAR4mXiTMx4mqwradYjvskoq3G4AG2tEwRqkg/exec';

let allMembers = [];
let allEvents = [];
let allPeriods = [];
let currentUserId = null;

const albumCache = {
    comments: {},
    reactions: {}
};

const ALBUM_AUTH_KEY = 'projectC_album_authenticated';
const ALBUM_USER_ID_KEY = 'projectC_album_user_id';

document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem(ALBUM_AUTH_KEY) === 'true') showAlbumContent();
    document.getElementById('upload-btn').addEventListener('click', handleUpload);

    const pwdInput = document.getElementById('album-password');
    if (pwdInput) {
        pwdInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') checkAlbumPassword(); });
        setTimeout(() => pwdInput.focus(), 100);
    }

    const memberSelectors = document.querySelectorAll('.member-select-sync');
    memberSelectors.forEach(select => {
        select.addEventListener('change', (e) => syncUserSelection(e.target.value));
    });

    document.getElementById('view-period-select').addEventListener('change', (e) => {
        updateAlbumEventSelect('view', e.target.value);
        document.getElementById('photo-grid').innerHTML = '';
    });

    document.getElementById('upload-period-select').addEventListener('change', (e) => {
        updateAlbumEventSelect('upload', e.target.value);
    });

    document.getElementById('view-event-select').addEventListener('change', (e) => {
        if (e.target.value) loadImages(e.target.value);
        else document.getElementById('photo-grid').innerHTML = '';
    });
});

function syncUserSelection(userId) {
    currentUserId = userId;
    const memberSelectors = document.querySelectorAll('.member-select-sync');
    memberSelectors.forEach(select => {
        select.value = userId;
    });

    if (userId) sessionStorage.setItem(ALBUM_USER_ID_KEY, userId);
    else sessionStorage.removeItem(ALBUM_USER_ID_KEY);

    const statusMsg = document.getElementById('modal-member-status');
    if (statusMsg) statusMsg.style.display = userId ? 'none' : 'block';

    if (currentPhotoId) loadComments(currentPhotoId, true);
}

function switchAlbumTab(tab) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (tab === 'view') {
        document.getElementById('album-view').classList.add('active');
        document.getElementById('tab-view-btn').classList.add('active');
    } else {
        document.getElementById('album-upload').classList.add('active');
        document.getElementById('tab-upload-btn').classList.add('active');
    }
}

async function checkAlbumPassword() {
    const pwdInput = document.getElementById('album-password');
    const password = pwdInput.value;
    if (!password) return;

    showLoading(true);
    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'verify_password', type: 'album', password: password })
        });
        const res = await response.json();
        if (res.result === 'success' && res.data.success) {
            sessionStorage.setItem(ALBUM_AUTH_KEY, 'true');
            showAlbumContent();
        } else {
            alert('パスワードが正しくありません。');
            pwdInput.value = ''; pwdInput.focus();
        }
    } catch (err) {
        console.error(err); alert('通信エラーが発生しました。');
    } finally { showLoading(false); }
}

function showAlbumContent() {
    document.getElementById('album-auth-area').style.display = 'none';
    document.getElementById('album-main-content').style.display = 'block';
    loadAlbumInitData();
}

async function loadAlbumInitData() {
    showLoading(true);
    try {
        const response = await fetch(`${GAS_URL}?action=get_album_init_data`);
        const data = await response.json();
        if (data.result === 'success') {
            allEvents = data.events || [];
            allPeriods = data.periods || [];
            allMembers = data.members || [];

            const activePeriods = allPeriods.filter(p => !p.isPast);
            const pastPeriods = allPeriods.filter(p => p.isPast);

            let periodOptions = '<option value="">-- 期間を選択 --</option>';
            if (pastPeriods.length > 0) {
                periodOptions += `<optgroup label="終了済み">${pastPeriods.map(p => `<option value="${p.periodId}" style="background-color: #666; color: white;">【終了】 ${p.periodName}</option>`).join('')}</optgroup>`;
            }
            if (activePeriods.length > 0) {
                periodOptions += `<optgroup label="開催中">${activePeriods.map(p => `<option value="${p.periodId}">${p.periodName}</option>`).join('')}</optgroup>`;
            }

            document.getElementById('view-period-select').innerHTML = periodOptions;
            document.getElementById('upload-period-select').innerHTML = periodOptions;

            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const curPeriod = allPeriods.find(p => {
                const start = p.startdate || p.startDate || p.periodDate || "";
                const end = p.enddate || p.endDate || "";
                return todayStr >= start && todayStr <= end;
            });

            if (curPeriod) {
                const pid = curPeriod.periodId;
                const viewPeriod = document.getElementById('view-period-select');
                const uploadPeriod = document.getElementById('upload-period-select');
                if (viewPeriod) viewPeriod.value = pid;
                if (uploadPeriod) uploadPeriod.value = pid;
                updateAlbumEventSelect('view', pid);
                updateAlbumEventSelect('upload', pid);
            }

            if (allMembers) {
                const memberSelectors = document.querySelectorAll('.member-select-sync');
                let memberOptions = '<option value="">-- 名前を選択 --</option>';
                const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                allMembers.filter(m => {
                    const join = m.joinmonth ? String(m.joinmonth).substring(0, 7) : null;
                    const leave = m.leavemonth ? String(m.leavemonth).substring(0, 7) : null;
                    return !((join && currentMonth < join) || (leave && currentMonth > leave));
                }).forEach(m => { memberOptions += `<option value="${m.id}">${m.name}</option>`; });

                memberSelectors.forEach(select => {
                    select.innerHTML = memberOptions;
                });

                const savedUserId = sessionStorage.getItem(ALBUM_USER_ID_KEY);
                if (savedUserId) {
                    currentUserId = savedUserId;
                    memberSelectors.forEach(select => {
                        select.value = savedUserId;
                    });
                }
            }
        }
    } catch (err) { console.error(err); } finally { showLoading(false); }
}

function updateAlbumEventSelect(tab, periodId) {
    const eventSelect = document.getElementById(`${tab}-event-select`);
    const period = allPeriods.find(p => String(p.periodId) === String(periodId));
    if (!period) { eventSelect.disabled = true; return; }

    const filteredEvents = allEvents.filter(e => e.date >= period.startdate && e.date <= period.enddate).sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
    const activeEvents = filteredEvents.filter(e => !e.isPast), pastEvents = filteredEvents.filter(e => e.isPast);

    let opt = '<option value="">-- イベントを選択 --</option>';
    if (pastEvents.length > 0) opt += `<optgroup label="終了済み">${pastEvents.map(e => `<option value="${e.date}_${e.name}" style="background-color: #666; color: white;">【終了】 ${e.canceled ? '[中止] ' : ''}${formatDate(e.date)} ${e.time || ''} ${e.name}</option>`).join('')}</optgroup>`;
    if (activeEvents.length > 0) opt += `<optgroup label="開催予定">${activeEvents.map(e => `<option value="${e.date}_${e.name}">${e.canceled ? '[中止] ' : ''}${formatDate(e.date)} ${e.time || ''} ${e.name}</option>`).join('')}</optgroup>`;

    eventSelect.innerHTML = opt;
    eventSelect.disabled = false;
}

async function handleUpload() {
    const eventName = document.getElementById('upload-event-select').value;
    const fileInput = document.getElementById('photo-input');
    const files = fileInput.files;
    if (!currentUserId || !eventName) { alert('名前とアップロード先を選択してください。'); return; }

    const contributor = (allMembers.find(m => String(m.id) === String(currentUserId)) || { name: '匿名' }).name;
    showLoading(true);
    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
        try {
            const file = files[i], base64Data = await compressImage(file, 1920, 0.8);
            const res = await fetch(GAS_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'upload_album_image', eventName, fileName: file.name, fileData: base64Data, contributor })
            }).then(r => r.json());
            if (res.result === 'success') successCount++;
        } catch (e) { console.error(e); }
    }
    showLoading(false);
    alert(`${successCount} 枚アップロード完了。`);
    fileInput.value = '';
    if (document.getElementById('view-event-select').value === eventName) loadImages(eventName);
}

async function loadImages(eventName) {
    const grid = document.getElementById('photo-grid');
    grid.innerHTML = '<p style="text-align:center; padding:2rem;">読み込み中...</p>';
    try {
        const data = await fetch(`${GAS_URL}?action=get_album_images&eventName=${encodeURIComponent(eventName)}`).then(r => r.json());
        if (data.images.length === 0) { grid.innerHTML = '<p style="padding:2rem; color:#64748b; text-align:center;">まだ写真がありません。</p>'; return; }

        grid.innerHTML = data.images.map(img => {
            const url = img.url.replace('drive.google.com/uc?id=', 'drive.google.com/thumbnail?sz=w1000&id=');
            const photoId = img.photoId || img.fileName;
            return `<div class="photo-item" id="photo-${photoId}"><img src="${url}" alt="${img.fileName}" onclick="openPhotoModal('${url}', '${photoId}')"></div>`;
        }).join('');
    } catch (e) { console.error(e); grid.innerHTML = '<p style="padding:2rem; color:red; text-align:center;">取得に失敗しました。</p>'; }
}

function openPhotoModal(url, photoId) {
    currentPhotoId = photoId;
    document.getElementById('modal-img').src = url;
    document.getElementById('photo-modal').classList.add('active');
    document.getElementById('comment-list').innerHTML = '';
    document.getElementById('comment-text').value = '';
    const statusMsg = document.getElementById('modal-member-status');
    if (statusMsg) statusMsg.style.display = currentUserId ? 'none' : 'block';
    loadComments(photoId);
}

function closePhotoModal() {
    document.getElementById('photo-modal').classList.remove('active');
    currentPhotoId = null;
}

async function loadComments(photoId, forceRefresh = false) {
    if (!forceRefresh && albumCache.comments[photoId]) { renderCommentsUI(albumCache.comments[photoId], albumCache.reactions[photoId], true); return; }
    try {
        const [cData, rData] = await Promise.all([
            fetch(`${GAS_URL}?action=getAlbumComments&photoId=${encodeURIComponent(photoId)}`).then(r => r.json()),
            fetch(`${GAS_URL}?action=get_reactions&photoId=${encodeURIComponent(photoId)}&userId=${encodeURIComponent(currentUserId || '')}`).then(r => r.json())
        ]);
        albumCache.comments[photoId] = cData.comments || [];
        albumCache.reactions[photoId] = rData || {};
        renderCommentsUI(albumCache.comments[photoId], albumCache.reactions[photoId], true);
        renderModalPhotoReactions(photoId);
    } catch (e) { console.error(e); }
}

function renderModalPhotoReactions(photoId) {
    const container = document.getElementById('modal-photo-reactions');
    if (!container) return;
    const rData = albumCache.reactions[photoId] || {};
    const photoReactions = rData[photoId] || { like: 0, love: 0, laugh: 0, party: 0, userReaction: null };
    const types = [{ type: 'like', emoji: '👍' }, { type: 'love', emoji: '❤️' }, { type: 'laugh', emoji: '😂' }, { type: 'party', emoji: '🎉' }];

    container.innerHTML = types.map(r => {
        const active = photoReactions.userReaction === r.type ? 'active' : '';
        return `<span class="reaction ${active}" onclick="toggleReaction('${photoId}', '${r.type}', true)">${r.emoji} ${photoReactions[r.type] || 0}</span>`;
    }).join('');
}

function renderCommentsUI(comments, rData, scroll = false) {
    const list = document.getElementById('comment-list');
    if (!comments || comments.length === 0) { list.innerHTML = '<p class="text-muted" style="text-align: center; padding: 1rem;">まだコメントはありません。</p>'; return; }

    list.innerHTML = comments.map(c => {
        const cid = c.commentid || c.commentId, uid = c.postuserid || c.postUserId, reactions = rData[cid] || { like: 0, love: 0, laugh: 0, party: 0, userReaction: null };
        const types = [{ type: 'like', emoji: '👍' }, { type: 'love', emoji: '❤️' }, { type: 'laugh', emoji: '😂' }, { type: 'party', emoji: '🎉' }];
        return `
            <div class="comment-item">
                <div class="comment-header"><span class="comment-author">${escapeHtml(c.username || c.userName)}</span><span class="comment-date">${c.timestamp || ''}</span></div>
                <div class="comment-text">${escapeHtml(c.commenttext || c.commentText)}</div>
                <div class="reactions">${types.map(r => `<span class="reaction ${reactions.userReaction === r.type ? 'active' : ''}" onclick="toggleReaction('${cid}', '${r.type}')">${r.emoji} ${reactions[r.type] || 0}</span>`).join('')}</div>
                ${currentUserId && String(uid) === String(currentUserId) ? `<div class="comment-actions"><button class="btn-text" onclick="updateAlbumComment('${cid}', '${uid}')">編集</button><button class="btn-text text-danger" onclick="deleteAlbumComment('${cid}', '${uid}')">削除</button></div>` : ''}
            </div>
        `;
    }).join('');
    if (scroll) list.scrollTop = list.scrollHeight;
}

async function toggleReaction(targetId, reactionType, isPhoto = false) {
    if (!currentUserId) { alert('名前を選択してください。'); return; }
    const photoId = isPhoto ? targetId : currentPhotoId;
    const rData = albumCache.reactions[photoId] || {};
    if (!rData[targetId]) rData[targetId] = { like: 0, love: 0, laugh: 0, party: 0, userReaction: null };
    const r = rData[targetId];
    if (r.userReaction === reactionType) { r.userReaction = null; r[reactionType]--; }
    else { if (r.userReaction) r[r.userReaction]--; r.userReaction = reactionType; r[reactionType]++; }
    if (isPhoto) renderModalPhotoReactions(photoId); else renderCommentsUI(albumCache.comments[photoId], rData);

    try {
        const res = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'save_reaction', photoId, commentId: targetId, userId: currentUserId, reactionType })
        }).then(r => r.json());
        albumCache.reactions[photoId] = res.data || {};
        if (isPhoto) renderModalPhotoReactions(photoId); else renderCommentsUI(albumCache.comments[photoId], albumCache.reactions[photoId]);
    } catch (e) { console.error(e); }
}

async function saveComment() {
    const txtArea = document.getElementById('comment-text'), text = txtArea.value.trim();
    if (!currentUserId || !text || !currentPhotoId) return;
    const member = allMembers.find(m => String(m.id) === String(currentUserId));
    try {
        const res = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'saveAlbumComment', photoId: currentPhotoId, userName: member ? member.name : '匿名', postUserId: currentUserId, commentText: text })
        }).then(r => r.json());
        if (res.result === 'success') { txtArea.value = ''; await loadComments(currentPhotoId, true); }
    } catch (e) { console.error(e); }
}

// Helpers
function compressImage(file, maxW, q) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = e => {
            const img = new Image(); img.src = e.target.result;
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > h) { if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; } }
                else { if (h > maxW) { w = Math.round(w * (maxW / h)); h = maxW; } }
                const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', q));
            };
        };
    });
}
async function updateAlbumComment(cid, uid) {
    const text = prompt('新しいコメント：'); if (!text) return; showLoading(true);
    try {
        const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'update_album_comment', commentId: cid, postUserId: uid, currentUserId, newContent: text }) }).then(r => r.json());
        if (res.result === 'success') await loadComments(currentPhotoId, true);
    } catch (e) { console.error(e); } finally { showLoading(false); }
}
async function deleteAlbumComment(cid, uid) {
    if (!confirm('削除しますか？')) return; showLoading(true);
    try {
        const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'delete_album_comment', commentId: cid, postUserId: uid, currentUserId }) }).then(r => r.json());
        if (res.result === 'success') await loadComments(currentPhotoId, true);
    } catch (e) { console.error(e); } finally { showLoading(false); }
}
function escapeHtml(s) { return s ? s.replace(/[&'`"<>]/g, m => ({ '&': '&amp;', "'": '&#39;', '`': '&#96;', '"': '&quot;', '<': '&lt;', '>': '&gt;', }[m])) : ""; }
function showLoading(s) { const o = document.getElementById('loading-overlay'); if (o) o.style.display = s ? 'flex' : 'none'; }
function formatDate(dStr) { if (!dStr) return ''; const d = new Date(dStr), days = ['日', '月', '火', '水', '木', '金', '土']; return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`; }
