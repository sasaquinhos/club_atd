// GAS Web App URL (デプロイ後に取得したURLをここに記載してください)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwsF3RR095GT3OHAXdbjMf_rhWnssLuJNZX7o-cAH4bqCOfLs8pwjrNdj1rHKb45fiEYA/exec';

let allMembers = [];
let allEvents = [];
let allPeriods = [];
let currentUserId = null;

// パフォーマンス向上のためのキャッシュ
const albumCache = {
    comments: {},  // photoId -> commentData
    reactions: {}  // photoId -> reactionData
};

const ALBUM_AUTH_KEY = 'projectC_album_authenticated';
const ALBUM_USER_ID_KEY = 'projectC_album_user_id';

document.addEventListener('DOMContentLoaded', () => {
    // 認証状態の確認
    if (sessionStorage.getItem(ALBUM_AUTH_KEY) === 'true') {
        showAlbumContent();
    }

    document.getElementById('upload-btn').addEventListener('click', handleUpload);

    // パスワード入力欄でEnterキー
    const pwdInput = document.getElementById('album-password');
    if (pwdInput) {
        pwdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') checkAlbumPassword();
        });
        setTimeout(() => pwdInput.focus(), 100);
    }

    // 期間選択時の連動 (閲覧用)
    document.getElementById('view-period-select').addEventListener('change', (e) => {
        updateAlbumEventSelect('view', e.target.value);
        document.getElementById('photo-grid').innerHTML = '';
    });

    // 期間選択時の連動 (アップロード用)
    document.getElementById('upload-period-select').addEventListener('change', (e) => {
        updateAlbumEventSelect('upload', e.target.value);
    });

    document.getElementById('view-event-select').addEventListener('change', (e) => {
        if (e.target.value) {
            loadImages(e.target.value);
        } else {
            document.getElementById('photo-grid').innerHTML = '';
        }
    });

    document.getElementById('comment-user').addEventListener('change', (e) => {
        currentUserId = e.target.value;
        if (currentUserId) {
            sessionStorage.setItem(ALBUM_USER_ID_KEY, currentUserId);
        } else {
            sessionStorage.removeItem(ALBUM_USER_ID_KEY);
        }

        // --- ユーザー切り替え時の不整合防止 ---
        // ユーザーを切り替えた瞬間は、誰がどのリアクションをしたかの情報が最新ではないため、
        // 読み込み完了まで一時的にリアクション表示をクリアするか、読み込みを待機する。
        Object.keys(albumCache.reactions).forEach(pid => {
            Object.keys(albumCache.reactions[pid]).forEach(cid => {
                if (albumCache.reactions[pid][cid] && typeof albumCache.reactions[pid][cid] === 'object') {
                    albumCache.reactions[pid][cid].userReaction = null;
                }
            });
        });

        if (currentPhotoId) {
            // キャッシュ（userReactionクリア済み）を使って即座に再描画し、その後最新を取得
            renderCommentsUI(albumCache.comments[currentPhotoId], albumCache.reactions[currentPhotoId], false);
            loadComments(currentPhotoId, true);
        }
    });
});

// 通信の競合を防ぐためのリクエストID管理
const lastRequestIdMap = {};

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

function checkAlbumPassword() {
    const pwdInput = document.getElementById('album-password');
    if (pwdInput.value === 'sdkk1171') {
        sessionStorage.setItem(ALBUM_AUTH_KEY, 'true');
        showAlbumContent();
    } else {
        alert('パスワードが正しくありません。');
        pwdInput.value = '';
        pwdInput.focus();
    }
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

            // 期間プルダウンの生成
            const periodOptions = '<option value="">-- 期間を選択 --</option>' +
                allPeriods.map(p => {
                    const label = p.isPast ? `${p.periodName}（終了）` : p.periodName;
                    const style = p.isPast ? 'style="background-color: #666; color: white;"' : '';
                    return `<option value="${p.periodId}" ${style}>${label}</option>`;
                }).join('');

            document.getElementById('view-period-select').innerHTML = periodOptions;
            document.getElementById('upload-period-select').innerHTML = periodOptions;

            // 現在の期間を自動選択
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

            // a.startdate または a.periodDate、a.enddate を使用して判定
            const curPeriod = allPeriods.find(p => {
                const start = p.startdate || p.periodDate || "";
                const end = p.enddate || "";
                return todayStr >= start && todayStr <= end;
            });

            if (curPeriod) {
                const pid = curPeriod.periodId;
                document.getElementById('view-period-select').value = pid;
                document.getElementById('upload-period-select').value = pid;
                updateAlbumEventSelect('view', pid);
                updateAlbumEventSelect('upload', pid);
            } else {
                // 初期状態ではイベント選択を無効化 (期間が見つからない場合)
                document.getElementById('view-event-select').innerHTML = '<option value="">-- 先に期間を選択してください --</option>';
                document.getElementById('view-event-select').disabled = true;
                document.getElementById('upload-event-select').innerHTML = '<option value="">-- 先に期間を選択してください --</option>';
                document.getElementById('upload-event-select').disabled = true;
            }

            // メンバー一覧の処理
            if (allMembers) {
                const userSelect = document.getElementById('comment-user');
                let memberOptions = '<option value="">-- 名前を選択 --</option>';

                // 現在の月を取得 (YYYY-MM)
                const now = new Date();
                const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

                // 在籍中のメンバーのみを抽出
                const activeMembers = allMembers.filter(m => {
                    const join = m.joinmonth ? String(m.joinmonth).substring(0, 7) : null;
                    const leave = m.leavemonth ? String(m.leavemonth).substring(0, 7) : null;

                    if (join && currentMonth < join) return false;
                    if (leave && currentMonth > leave) return false;
                    return true;
                });

                activeMembers.forEach(m => {
                    memberOptions += `<option value="${m.id}">${m.name}</option>`;
                });
                userSelect.innerHTML = memberOptions;

                // 保存されていたユーザーの復元
                const savedUserId = sessionStorage.getItem(ALBUM_USER_ID_KEY);
                if (savedUserId && Array.from(userSelect.options).some(opt => opt.value === savedUserId)) {
                    userSelect.value = savedUserId;
                    currentUserId = savedUserId;
                }
            }
        }
    } catch (error) {
        console.error('Error loading album init data:', error);
    } finally {
        showLoading(false);
    }
}

function updateAlbumEventSelect(tab, periodId) {
    const eventSelect = document.getElementById(`${tab}-event-select`);
    if (!periodId) {
        eventSelect.innerHTML = '<option value="">-- 先に期間を選択してください --</option>';
        eventSelect.disabled = true;
        return;
    }

    const period = allPeriods.find(p => String(p.periodId) === String(periodId));
    if (!period) {
        eventSelect.innerHTML = '<option value="">-- 期間データが見つかりません --</option>';
        eventSelect.disabled = true;
        return;
    }

    // 期間内のイベントを絞り込み
    const filteredEvents = allEvents.filter(e => e.date >= period.startdate && e.date <= period.enddate);

    let eventOptions = '<option value="">-- イベントを選択 --</option>';
    filteredEvents.forEach(event => {
        const label = `${event.canceled ? '[中止] ' : ''}${formatDate(event.date)} ${event.time || ''} ${event.name}${event.isPast ? '（終了）' : ''}`;
        const style = event.isPast ? 'style="background-color: #666; color: white;"' : '';
        const value = `${event.date}_${event.name}`;
        eventOptions += `<option value="${value}" ${style}>${label}</option>`;
    });

    eventSelect.innerHTML = eventOptions;
    eventSelect.disabled = false;
}


async function handleUpload() {
    const eventName = document.getElementById('upload-event-select').value;
    const fileInput = document.getElementById('photo-input');
    const files = fileInput.files;

    if (!eventName || files.length === 0) {
        alert('イベントと写真を選択してください。');
        return;
    }

    showLoading(true);
    const statusDiv = document.getElementById('upload-status');
    statusDiv.innerText = `0 / ${files.length} 枚アップロード中...`;

    let successCount = 0;
    const errors = [];

    for (let i = 0; i < files.length; i++) {
        try {
            const file = files[i];
            // 圧縮処理を追加 (Max 1920px, Quality 0.8)
            const base64Data = await compressImage(file, 1920, 0.8);

            const response = await fetch(GAS_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'upload_album_image',
                    eventName: eventName,
                    fileName: file.name,
                    fileData: base64Data
                })
            });

            const result = await response.json();
            console.log('Upload result:', result); // Debug log

            if (result.result === 'success') {
                successCount++;
                statusDiv.innerText = `${i + 1} / ${files.length} 枚処理中... (成功: ${successCount})`;
            } else {
                console.error('Upload failed:', result);
                const errorMsg = result.error || 'Unknown error';
                errors.push(`${file.name}: ${errorMsg}`);
                statusDiv.innerText = `${i + 1} / ${files.length} 枚処理中... (成功: ${successCount})\nエラー: ${errorMsg}`;
            }
        } catch (error) {
            console.error('Upload error:', error);
            errors.push(`${file.name}: ${error.message}`);
            statusDiv.innerText = `${i + 1} / ${files.length} 枚処理中... (成功: ${successCount})\n通信エラー: ${error.message}`;
        }
    }

    showLoading(false);

    if (successCount === files.length) {
        alert(`${successCount} 枚の写真をアップロードしました。`);
    } else {
        const errorSummary = errors.join('\n');
        alert(`${successCount} / ${files.length} 枚のアップロードに成功しました。\n\n【失敗したファイル】\n${errorSummary}`);
    }

    // ファイル選択をクリア
    fileInput.value = '';

    // 閲覧タブのリロード（同じイベントを選択していた場合）
    if (document.getElementById('view-event-select').value === eventName) {
        loadImages(eventName);
    }
}

async function loadImages(eventName) {
    const grid = document.getElementById('photo-grid');
    grid.innerHTML = '<p style="text-align:center; padding:2rem;">読み込み中...</p>';

    try {
        const response = await fetch(`${GAS_URL}?action=get_album_images&eventName=${encodeURIComponent(eventName)}`);
        const data = await response.json();

        if (data.images.length === 0) {
            grid.innerHTML = '<p style="text-align:center; padding:2rem; color:#64748b;">まだ写真がありません。</p>';
            return;
        }

        grid.innerHTML = '';
        data.images.forEach(img => {
            // URL変換: uc?id=... -> thumbnail?sz=w1000&id=...
            // これにより、既存の画像も新しい形式で表示されるようになります
            let displayUrl = img.url;
            if (displayUrl.includes('drive.google.com/uc?id=')) {
                displayUrl = displayUrl.replace('drive.google.com/uc?id=', 'drive.google.com/thumbnail?sz=w1000&id=');
            }

            const item = document.createElement('div');
            item.className = 'photo-item';
            // photoIdとして、とりあえずfileNameを使用（一意であることを期待）
            const photoId = img.fileName;
            item.innerHTML = `
                <img src="${displayUrl}" alt="${img.fileName}" onclick="openPhotoModal('${displayUrl}', '${photoId}')" onerror="this.src='https://placehold.co/600x400?text=Load+Error'">
            `;
            grid.appendChild(item);
        });
    } catch (error) {
        console.error('Error fetching images:', error);
        grid.innerHTML = '<p style="text-align:center; padding:2rem; color:red;">写真の取得に失敗しました。</p>';
    }
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

/**
 * 画像を圧縮してBase64で返す
 * @param {File} file 
 * @param {number} maxWidth 最大幅/高さ
 * @param {number} quality JPEG画質 (0.0 - 1.0)
 */
function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round(height * (maxWidth / width));
                        width = maxWidth;
                    }
                } else {
                    if (height > maxWidth) {
                        width = Math.round(width * (maxWidth / height));
                        height = maxWidth;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // canvas.toDataURL の第2引数で画質指定(JPEGのみ有効)
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

let currentPhotoId = null;

function openPhotoModal(url, photoId) {
    currentPhotoId = photoId;
    const modal = document.getElementById('photo-modal');
    const modalImg = document.getElementById('modal-img');
    modalImg.src = url;
    modal.classList.add('active');

    // コメントエリアを一旦クリア（前画面の残像防止）
    document.getElementById('comment-list').innerHTML = '';
    // コメント入力欄をクリア
    document.getElementById('comment-text').value = '';

    // コメント読み込み
    loadComments(photoId);
}

function closePhotoModal() {
    document.getElementById('photo-modal').classList.remove('active');
    currentPhotoId = null;
}

async function loadComments(photoId, forceRefresh = false) {
    const commentList = document.getElementById('comment-list');

    // リクエストIDを記録（最新のリクエストのみを採用するため）
    const requestId = Date.now();
    lastRequestIdMap[photoId] = requestId;

    // キャッシュがあれば即座に描画
    if (!forceRefresh && albumCache.comments[photoId] && albumCache.reactions[photoId]) {
        renderCommentsUI(albumCache.comments[photoId], albumCache.reactions[photoId], true);
    } else {
        if (!forceRefresh) commentList.innerHTML = '<p class="text-muted" style="text-align: center; padding: 1rem;">読み込み中...</p>';
    }

    try {
        // userIdが未確定でも、一旦リクエストは投げる（全体集計のため）
        // ただし、currentUserIdがsessionStorage等から復元される可能性があるため最新を見る
        const effectiveUserId = currentUserId || sessionStorage.getItem(ALBUM_USER_ID_KEY) || '';
        const reactionUrl = `${GAS_URL}?action=get_reactions&photoId=${photoId}&userId=${effectiveUserId}`;
        const [commentData, reactionData] = await Promise.all([
            fetch(`${GAS_URL}?action=getAlbumComments&photoId=${photoId}`).then(res => res.json()),
            fetch(reactionUrl).then(res => res.json())
        ]);

        // 最新のリクエストでなければ無視（不整合防止）
        if (lastRequestIdMap[photoId] !== requestId) return;

        // キャッシュを更新
        albumCache.comments[photoId] = commentData.comments || [];
        albumCache.reactions[photoId] = reactionData || {};

        renderCommentsUI(albumCache.comments[photoId], albumCache.reactions[photoId], true);

    } catch (error) {
        console.error('Error loading comments:', error);
        if (lastRequestIdMap[photoId] === requestId && !albumCache.comments[photoId]) {
            commentList.innerHTML = '<p style="color: red; text-align: center; padding: 1rem;">読み込みに失敗しました。</p>';
        }
    }
}

/**
 * コメントとリアクションを描画する内部関数
 * @param {boolean} shouldScroll スクロールを一番下に移動させるか
 */
function renderCommentsUI(comments, reactionData, shouldScroll = false) {
    const commentList = document.getElementById('comment-list');
    if (!comments || comments.length === 0) {
        commentList.innerHTML = '<p class="text-muted" style="text-align: center; padding: 1rem;">まだコメントはありません。</p>';
        return;
    }

    commentList.innerHTML = comments.map(c => {
        const isOwner = currentUserId && String(c.postuserid) === String(currentUserId);
        const ownerActions = isOwner ? `
            <div class="comment-actions">
                <button class="btn-text" onclick="updateAlbumComment('${c.commentid}', '${c.postuserid}')">編集</button>
                <button class="btn-text text-danger" onclick="deleteAlbumComment('${c.commentid}', '${c.postuserid}')">削除</button>
            </div>
        ` : '';

        const reactions = reactionData[c.commentid] || { like: 0, love: 0, laugh: 0, party: 0, userReaction: null };
        const reactionTypes = [
            { type: 'like', emoji: '👍' },
            { type: 'love', emoji: '❤️' },
            { type: 'laugh', emoji: '😂' },
            { type: 'party', emoji: '🎉' }
        ];

        const reactionHtml = `
            <div class="reactions">
                ${reactionTypes.map(r => {
            const isActive = reactions.userReaction === r.type ? 'active' : '';
            const count = reactions[r.type] || 0;
            return `<span class="reaction ${isActive}" data-type="${r.type}" onclick="toggleReaction('${c.commentid}', '${r.type}')">${r.emoji} ${count}</span>`;
        }).join('')}
            </div>
        `;

        return `
            <div class="comment-item" id="comment-${c.commentid}">
                <div class="comment-header">
                    <span class="comment-author">${escapeHtml(c.username)}</span>
                    <span class="comment-date">${c.timestamp}</span>
                </div>
                <div class="comment-text">${escapeHtml(c.commenttext)}</div>
                ${reactionHtml}
                ${ownerActions}
            </div>
        `;
    }).join('');

    if (shouldScroll) {
        commentList.scrollTop = commentList.scrollHeight;
    }
}


async function toggleReaction(commentId, reactionType) {
    if (!currentUserId) {
        alert('名前を選択してください。');
        return;
    }

    const photoId = currentPhotoId;
    if (!albumCache.reactions[photoId]) {
        albumCache.reactions[photoId] = {};
    }
    if (!albumCache.reactions[photoId][commentId]) {
        albumCache.reactions[photoId][commentId] = { like: 0, love: 0, laugh: 0, party: 0, userReaction: null };
    }

    const oldReactions = JSON.parse(JSON.stringify(albumCache.reactions[photoId])); // バックアップ
    const commentReactions = albumCache.reactions[photoId][commentId];

    // --- 楽観的UI更新 ---
    const isRemove = commentReactions.userReaction === reactionType;
    if (isRemove) {
        commentReactions.userReaction = null;
        commentReactions[reactionType] = Math.max(0, (commentReactions[reactionType] || 0) - 1);
    } else {
        // 他のリアクションを消して付け替える、または新規
        // もし userReaction が null の場合でも、サーバー側で重複を弾くようにしているが、
        // フロントエンドでも可能な限り「自分が既に押しているものがないか」を確認する
        if (commentReactions.userReaction && commentReactions.userReaction !== reactionType) {
            const prevType = commentReactions.userReaction;
            commentReactions[prevType] = Math.max(0, (commentReactions[prevType] || 0) - 1);
        }
        commentReactions.userReaction = reactionType;
        commentReactions[reactionType] = (commentReactions[reactionType] || 0) + 1;
    }


    // 即座に再描画（楽観的）
    renderCommentsUI(albumCache.comments[photoId], albumCache.reactions[photoId], false);

    const requestId = Date.now();
    lastRequestIdMap[photoId] = requestId;

    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'save_reaction',
                photoId: photoId,
                commentId: commentId,
                userId: currentUserId,
                reactionType: reactionType
            })
        });

        const result = await response.json();

        // 最新のリクエストでなければ無視
        if (lastRequestIdMap[photoId] !== requestId) return;

        // サーバーからの最新データ（result.data）でキャッシュを上書き同期
        albumCache.reactions[photoId] = result.data || {};
        renderCommentsUI(albumCache.comments[photoId], albumCache.reactions[photoId], false);

    } catch (error) {
        console.error('Error toggling reaction:', error);
        // エラー時はロールバック
        if (lastRequestIdMap[photoId] === requestId) {
            albumCache.reactions[photoId] = oldReactions;
            renderCommentsUI(albumCache.comments[photoId], albumCache.reactions[photoId], false);
            alert('リアクションの反映に失敗しました。');
        }
    }
}



async function saveComment() {
    const userSelect = document.getElementById('comment-user');
    const textField = document.getElementById('comment-text');
    const postUserId = userSelect.value;
    const commentText = textField.value.trim();

    // 選択された名前を取得
    const selectedOption = userSelect.options[userSelect.selectedIndex];
    const userName = selectedOption ? selectedOption.text : '';

    if (!postUserId || !commentText || !currentPhotoId) {
        alert('名前を選択し、コメントを入力してください。');
        return;
    }

    // セレクターを HTML 構造に合わせて修正 (.comment-form 内の button)
    const submitBtn = document.querySelector('.comment-form button');
    const originalBtnText = submitBtn ? submitBtn.innerText : '送信';

    try {
        // 連打防止: ボタンがある場合は無効化
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = '送信中...';
        }

        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'saveAlbumComment',
                photoId: currentPhotoId,
                userName: userName,
                postUserId: postUserId,
                commentText: commentText
            })
        });

        const result = await response.json();
        if (result.result === 'success') {
            textField.value = '';
            // 保存後は強制的にリフレッシュ
            await loadComments(currentPhotoId, true);
        } else {
            alert('保存に失敗しました: ' + (result.error || '不明なエラー'));
        }
    } catch (error) {
        console.error('Error saving comment:', error);
        alert('通信エラーが発生しました。');
    } finally {
        // ボタンを復元
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = originalBtnText;
        }
    }
}

async function updateAlbumComment(commentId, postUserId) {
    const newContent = prompt('コメントを編集します。新しい内容を入力してください：');
    if (newContent === null) return;
    if (newContent.trim() === '') {
        alert('内容を入力してください。');
        return;
    }

    try {
        showLoading(true);
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'update_album_comment',
                commentId: commentId,
                postUserId: postUserId,
                currentUserId: currentUserId,
                newContent: newContent.trim()
            })
        });

        const result = await response.json();
        if (result.result === 'success') {
            await loadComments(currentPhotoId, true);
        } else {
            alert('更新に失敗しました: ' + (result.error || '不明なエラー'));
        }
    } catch (error) {
        console.error('Error updating comment:', error);
        alert('通信エラーが発生しました。');
    } finally {
        showLoading(false);
    }
}

async function deleteAlbumComment(commentId, postUserId) {
    if (!confirm('このコメントを削除してもよろしいですか？')) return;

    try {
        showLoading(true);
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'delete_album_comment',
                commentId: commentId,
                postUserId: postUserId,
                currentUserId: currentUserId
            })
        });

        const result = await response.json();
        if (result.result === 'success') {
            await loadComments(currentPhotoId, true);
        } else {
            alert('削除に失敗しました: ' + (result.error || '不明なエラー'));
        }
    } catch (error) {
        console.error('Error deleting comment:', error);
        alert('通信エラーが発生しました。');
    } finally {
        showLoading(false);
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&'`"<>]/g, function (match) {
        return {
            '&': '&amp;',
            "'": '&#39;',
            '`': '&#96;',
            '"': '&quot;',
            '<': '&lt;',
            '>': '&gt;',
        }[match]
    });
}

function showLoading(show) {
    document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}
/**
 * 日付フォーマット (M/D(曜))
 */
function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}
