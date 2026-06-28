// ── Session & Logging ────────────────────────────────────────────────────────
function getSessionId() {
    let sid = localStorage.getItem('cytron_sid');
    if (!sid) {
        sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        localStorage.setItem('cytron_sid', sid);
    }
    return sid;
}
const SESSION_ID = getSessionId();

function logEvent(event, productId, productName) {
    fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sid:          SESSION_ID,
            event:        event,
            query:        searchQuery,
            product_id:   productId   || null,
            product_name: productName || '',
        }),
    }).catch(() => {});
}

// ── Tab ──────────────────────────────────────────────────────────────────────
let activeTab = 'kit';

function switchTab(tab) {
    activeTab = tab;
    document.getElementById('panel-kit').style.display   = tab === 'kit'   ? 'flex' : 'none';
    document.getElementById('panel-batch').style.display = tab === 'batch' ? 'flex' : 'none';
    document.getElementById('tab-kit').classList.toggle('active',   tab === 'kit');
    document.getElementById('tab-batch').classList.toggle('active', tab === 'batch');
}

// ── Batch Search ──────────────────────────────────────────────────────────────
let batchResults = [];

function parseBatchInput(text) {
    return text.split('\n')
        .map(line => line.trim())
        .map(line => line.replace(/^\d+[.)]\s*/, ''))   // "1. " or "1) "
        .map(line => line.replace(/^[-*•]\s*/, ''))      // "- " "* " "• "
        .filter(line => line.length > 0);
}

async function doBatchSearch() {
    const raw   = document.getElementById('batch-input').value;
    const items = parseBatchInput(raw);
    if (items.length === 0) { showToast('วาง list สินค้าก่อน'); return; }

    const btn = document.getElementById('batch-search-btn');
    btn.disabled    = true;
    btn.textContent = 'กำลังค้นหา...';
    document.getElementById('batch-results').innerHTML =
        `<div class="batch-loading">กำลังค้นหา ${items.length} รายการ...</div>`;
    document.getElementById('batch-footer').style.display = 'none';

    try {
        const res  = await fetch('/api/batch-search', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ items }),
        });
        batchResults = await res.json();
        renderBatchResults();
    } catch {
        document.getElementById('batch-results').innerHTML =
            '<div class="batch-loading">เกิดข้อผิดพลาด ลองใหม่อีกครั้ง</div>';
    }

    btn.disabled    = false;
    btn.textContent = 'ค้นหาทั้งหมด';
}

function renderBatchResults() {
    const el = document.getElementById('batch-results');
    if (!batchResults.length) { el.innerHTML = ''; return; }

    el.innerHTML = batchResults.map((r, i) => {
        const num = i + 1;
        let tag, body;

        if (r.status === 'found') {
            tag  = `<span class="batch-tag batch-tag-found">✅ พบ</span>`;
            body = `<div class="batch-match">${escHtml(r.name)} — ${escHtml(r.price)}<br>
                    <a href="${escAttr(r.url)}" target="_blank">${escHtml(r.url)}</a></div>`;
        } else if (r.status === 'suggest') {
            tag  = `<span class="batch-tag batch-tag-suggest">⚠️ ใกล้เคียง</span>`;
            body = `<div class="batch-match">${escHtml(r.name)} — ${escHtml(r.price)}<br>
                    <a href="${escAttr(r.url)}" target="_blank">${escHtml(r.url)}</a></div>`;
        } else {
            tag  = `<span class="batch-tag batch-tag-none">ไม่มีของ</span>`;
            body = '';
        }

        return `
            <div class="batch-row">
                <span class="batch-num">${num}.</span>
                <div class="batch-body">
                    <div class="batch-query">${escHtml(r.query)}</div>
                    ${body}
                </div>
                ${tag}
            </div>`;
    }).join('');

    document.getElementById('batch-footer').style.display = 'block';
}

function copyBatchResult() {
    if (!batchResults.length) return;
    const lines = batchResults.map((r, i) => {
        const num = i + 1;
        if (r.status === 'not_found') {
            return `${num}. ${r.query} → ไม่มีของ`;
        }
        const tag = r.status === 'suggest' ? ' [ใกล้เคียง]' : '';
        return `${num}. ${r.query} → ${r.name} (${r.price})${tag}\n   ${r.url}`;
    });
    const text = lines.join('\n');
    navigator.clipboard.writeText(text)
        .then(() => showToast('✓ Copy แล้ว!'))
        .catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('✓ Copy แล้ว!');
        });
}

// ── State ────────────────────────────────────────────────────────────────────
let catalog        = [];
let allProducts    = [];   // flat list, each product has .id (SQLite int), .category, .subcategory
let productMap     = {};   // String(id) -> product
let kitItems       = [];   // [{ product, qty }]
let activeCat      = null;
let activeSubcat   = null;
let searchQuery    = '';
let expandedCats   = new Set();
let vectorResults  = [];   // ผล vector search [{id,name,score,status,...}]
let searchDebounce = null;
let searchLoading  = false;

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    document.getElementById('product-grid').innerHTML =
        '<div class="loading">กำลังโหลดสินค้า...</div>';

    const res = await fetch('/api/catalog');
    catalog   = await res.json();
    buildProductList();
    renderSidebar();
    renderProducts();
    bindEvents();
}

function buildProductList() {
    for (const cat of catalog) {
        for (const sub of cat.subcategories) {
            for (const p of sub.products) {
                const product = { ...p, category: cat.name, subcategory: sub.name };
                productMap[String(p.id)] = product;
                allProducts.push(product);
            }
        }
    }
}

function bindEvents() {
    document.getElementById('search-input').addEventListener('input', e => {
        searchQuery = e.target.value.trim();
        clearTimeout(searchDebounce);
        if (!searchQuery) {
            vectorResults = [];
            renderProducts();
            return;
        }
        searchLoading = true;
        renderProducts();
        searchDebounce = setTimeout(() => doVectorSearch(searchQuery), 400);
    });

    document.getElementById('search-input').addEventListener('keydown', e => {
        if (e.key === 'Enter' && searchQuery) logEvent('search');
    });

    document.getElementById('sidebar-all').addEventListener('click', selectAll);
    document.getElementById('clear-btn').addEventListener('click', clearKit);
    document.getElementById('copy-btn').addEventListener('click', copyToClipboard);

    // Event delegation — sidebar tree
    document.getElementById('cat-tree').addEventListener('click', e => {
        const catEl    = e.target.closest('.cat-name');
        const subcatEl = e.target.closest('.subcat-name');
        if (subcatEl) {
            selectSubcat(subcatEl.dataset.cat, subcatEl.dataset.subcat);
        } else if (catEl) {
            toggleCat(Number(catEl.dataset.ci), catEl.dataset.cat);
        }
    });

    // Event delegation — product grid
    document.getElementById('product-grid').addEventListener('click', e => {
        const addBtn = e.target.closest('.add-btn');
        const card   = e.target.closest('.product-card');
        if (!card) return;
        if (addBtn) {
            addToKit(card.dataset.pid);
        } else {
            showPreview(card.dataset.pid);
        }
    });

    // Event delegation — kit items
    document.getElementById('kit-items').addEventListener('click', e => {
        const del = e.target.closest('.del-btn');
        const qty = e.target.closest('.qty-btn');
        if (del) {
            removeFromKit(Number(del.dataset.index));
        } else if (qty) {
            updateQty(Number(qty.dataset.index), Number(qty.dataset.delta));
        }
    });
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar() {
    document.getElementById('sidebar-all').classList.toggle('active', activeCat === null);

    document.getElementById('cat-tree').innerHTML = catalog.map((cat, ci) => `
        <div class="cat-item">
            <div class="cat-name ${activeCat === cat.name && !activeSubcat ? 'active' : ''}"
                 data-ci="${ci}" data-cat="${escAttr(cat.name)}">
                <span>${escHtml(cat.name)}</span>
                <span class="cat-arrow ${expandedCats.has(ci) ? 'open' : ''}">▶</span>
            </div>
            <div class="subcat-list ${expandedCats.has(ci) ? 'open' : ''}">
                ${cat.subcategories.map(sub => `
                    <div class="subcat-name ${activeSubcat === sub.name ? 'active' : ''}"
                         data-cat="${escAttr(cat.name)}" data-subcat="${escAttr(sub.name)}">
                        ${escHtml(sub.name)}
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

async function doVectorSearch(q) {
    try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=20&sid=${SESSION_ID}`);
        const data = await res.json();
        // enrich ด้วย category/subcategory จาก productMap
        vectorResults = data
            .map(r => ({ ...productMap[String(r.id)], ...r }))
            .filter(r => productMap[String(r.id)]);
    } catch {
        vectorResults = [];
    }
    searchLoading = false;
    if (searchQuery === q) renderProducts();
}

function selectAll() {
    activeCat     = null;
    activeSubcat  = null;
    searchQuery   = '';
    vectorResults = [];
    document.getElementById('search-input').value = '';
    renderSidebar();
    renderProducts();
}

function toggleCat(ci, catName) {
    if (expandedCats.has(ci)) {
        expandedCats.delete(ci);
    } else {
        expandedCats.add(ci);
    }
    activeCat    = catName;
    activeSubcat = null;
    searchQuery  = '';
    vectorResults = [];
    document.getElementById('search-input').value = '';
    renderSidebar();
    renderProducts();
}

function selectSubcat(catName, subcatName) {
    activeCat    = catName;
    activeSubcat = subcatName;
    searchQuery  = '';
    vectorResults = [];
    document.getElementById('search-input').value = '';
    if (!expandedCats.has(catalog.findIndex(c => c.name === catName))) {
        expandedCats.add(catalog.findIndex(c => c.name === catName));
    }
    renderSidebar();
    renderProducts();
}

// ── Products ──────────────────────────────────────────────────────────────────
function getFilteredProducts() {
    if (searchQuery) return vectorResults;
    if (activeSubcat) return allProducts.filter(p => p.subcategory === activeSubcat);
    if (activeCat)    return allProducts.filter(p => p.category === activeCat);
    return allProducts;
}

function isInKit(pid) {
    return kitItems.some(item => !item.isPlaceholder && String(item.product.id) === pid);
}

function renderProducts() {
    const products = getFilteredProducts();
    const grid     = document.getElementById('product-grid');
    const label    = document.getElementById('section-label');

    if (searchQuery) {
        if (searchLoading) {
            label.textContent = `ค้นหา "${searchQuery}"...`;
            grid.innerHTML = '<div class="loading">กำลังค้นหา...</div>';
            return;
        }
        label.textContent = `ค้นหา "${searchQuery}" — ${products.length} รายการ`;
    } else if (activeSubcat) {
        label.textContent = activeSubcat;
    } else if (activeCat) {
        label.textContent = activeCat;
    } else {
        label.textContent = `ทั้งหมด — ${allProducts.length} รายการ`;
    }

    if (products.length === 0) {
        grid.innerHTML = `
            <div class="empty">
                <div class="empty-icon">🔍</div>
                <div>ไม่พบสินค้า</div>
                ${searchQuery ? `<button class="btn-no-stock" onclick="addPlaceholderToKit('${escAttr(searchQuery)}')">+ เพิ่ม "${escHtml(searchQuery)}" เป็น ไม่มีสินค้า</button>` : ''}
            </div>`;
        return;
    }

    const isSearch = !!searchQuery;

    // แสดงปุ่ม "ไม่มีสินค้า" เมื่อผลดีสุดยัง not_found
    const topStatus = isSearch ? products[0]?.status : null;
    const noStockBanner = (topStatus === 'not_found')
        ? `<div class="no-stock-banner">
               ไม่พบสินค้าที่ตรงกัน &nbsp;
               <button class="btn-no-stock" onclick="addPlaceholderToKit('${escAttr(searchQuery)}')">+ เพิ่ม "${escHtml(searchQuery)}" เป็น ไม่มีสินค้า</button>
           </div>`
        : '';
    grid.innerHTML = noStockBanner + products.map(p => {
        const pid   = String(p.id);
        const inKit = isInKit(pid);
        const imgTag = p.image_url
            ? `<img class="product-img" src="${escAttr(p.image_url)}" alt="" loading="lazy" onerror="this.replaceWith(makePh())">`
            : `<div class="product-img-ph">📦</div>`;

        const scoreBadge = isSearch && p.score != null
            ? `<div class="score-badge score-${p.status}">${p.score.toFixed(2)}</div>`
            : '';

        return `
            <div class="product-card ${inKit ? 'in-kit' : ''}" data-pid="${pid}">
                ${scoreBadge}
                ${imgTag}
                <div class="product-name">${escHtml(p.name)}</div>
                <div class="product-price">${escHtml(p.price)}</div>
                <button class="add-btn ${inKit ? 'added' : ''}">
                    ${inKit ? '✓ เพิ่มแล้ว' : '+ เพิ่ม'}
                </button>
            </div>
        `;
    }).join('');
}

function makePh() {
    const d = document.createElement('div');
    d.className = 'product-img-ph';
    d.textContent = '📦';
    return d;
}

// ── Kit ───────────────────────────────────────────────────────────────────────
function addToKit(pid) {
    const product  = productMap[pid];
    if (!product) return;
    const existing = kitItems.find(item => !item.isPlaceholder && String(item.product.id) === pid);
    if (existing) {
        existing.qty += 1;
    } else {
        kitItems.push({ product, qty: 1, isPlaceholder: false, note: '', isSubstitute: false });
    }
    logEvent('add_kit', product.id, product.name);
    renderKitList();
    renderProducts();
}

function addPlaceholderToKit(name) {
    kitItems.push({ product: null, name, qty: 1, isPlaceholder: true, note: '', isSubstitute: false });
    logEvent('no_stock', null, name);
    renderKitList();
    showToast(`เพิ่ม "${name}" เป็นไม่มีสินค้าแล้ว`);
}

function addNoStockFromSearch() {
    const name = searchQuery.trim() || 'ไม่ระบุ';
    addPlaceholderToKit(name);
}

function removeFromKit(index) {
    kitItems.splice(index, 1);
    renderKitList();
    renderProducts();
}

function updateQty(index, delta) {
    const newQty = kitItems[index].qty + delta;
    if (newQty < 1) return;
    kitItems[index].qty = newQty;
    renderKitList();
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────
let dragSrc = null;

function kitDragStart(e, index) {
    dragSrc = index;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging');
}

function kitDragOver(e, index) {
    e.preventDefault();
    if (dragSrc === null || dragSrc === index) return;
    document.querySelectorAll('.kit-item').forEach(el => el.classList.remove('drag-over'));
    e.currentTarget.classList.add('drag-over');
}

function kitDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function kitDrop(e, targetIndex) {
    e.preventDefault();
    document.querySelectorAll('.kit-item').forEach(el => el.classList.remove('drag-over', 'dragging'));
    if (dragSrc === null || dragSrc === targetIndex) { dragSrc = null; return; }
    const moved = kitItems.splice(dragSrc, 1)[0];
    kitItems.splice(targetIndex, 0, moved);
    dragSrc = null;
    renderKitList();
}

function kitDragEnd() {
    document.querySelectorAll('.kit-item').forEach(el => el.classList.remove('drag-over', 'dragging'));
    dragSrc = null;
}

// ── Substitute ────────────────────────────────────────────────────────────────
function toggleSubstitute(index) {
    kitItems[index].isSubstitute = !kitItems[index].isSubstitute;
    renderKitList();
}

function clearKit() {
    if (kitItems.length === 0) return;
    kitItems = [];
    renderKitList();
    renderProducts();
}

function renderKitList() {
    document.getElementById('kit-count').textContent = kitItems.length;

    const container = document.getElementById('kit-items');
    if (kitItems.length === 0) {
        container.innerHTML = '<div class="empty"><div class="empty-icon">🛒</div><div>ยังไม่มีสินค้า<br>คลิกสินค้าเพื่อเพิ่ม</div></div>';
    } else {
        container.innerHTML = kitItems.map((item, i) => {
            const num = i + 1;
            const noteInput  = `<input class="kit-note" placeholder="note (optional)" value="${escAttr(item.note || '')}" oninput="updateNote(${i}, this.value)">`;
            const subBadge   = item.isSubstitute ? `<span class="badge-sub">ทดแทน</span>` : '';
            const subBtn     = `<button class="btn-sub ${item.isSubstitute ? 'active' : ''}" onclick="toggleSubstitute(${i})" title="ทดแทน">⇄</button>`;
            const dragAttrs  = `draggable="true" ondragstart="kitDragStart(event,${i})" ondragover="kitDragOver(event,${i})" ondragleave="kitDragLeave(event)" ondrop="kitDrop(event,${i})" ondragend="kitDragEnd()"`;

            if (item.isPlaceholder) {
                return `
                    <div class="kit-item kit-item-placeholder" ${dragAttrs}>
                        <div class="kit-drag-handle">⠿</div>
                        <div class="kit-num">${num}.</div>
                        <div class="kit-thumb-ph">📦</div>
                        <div class="kit-info">
                            <div class="kit-name">${escHtml(item.name)} ${subBadge}</div>
                            <div class="kit-no-stock">ไม่มีสินค้า</div>
                            ${noteInput}
                        </div>
                        <div class="kit-qty">
                            <button class="qty-btn" data-index="${i}" data-delta="-1">−</button>
                            <span class="qty-val">${item.qty}</span>
                            <button class="qty-btn" data-index="${i}" data-delta="1">+</button>
                        </div>
                        ${subBtn}
                        <button class="del-btn" data-index="${i}" title="ลบ">✕</button>
                    </div>`;
            }
            const thumb = item.product.image_url
                ? `<img class="kit-thumb" src="${escAttr(item.product.image_url)}" alt="" onerror="this.style.display='none'">`
                : `<div class="kit-thumb-ph">📦</div>`;
            return `
                <div class="kit-item" ${dragAttrs}>
                    <div class="kit-drag-handle">⠿</div>
                    <div class="kit-num">${num}.</div>
                    ${thumb}
                    <div class="kit-info">
                        <div class="kit-name" title="${escAttr(item.product.name)}">${escHtml(item.product.name)} ${subBadge}</div>
                        <div class="kit-price">${escHtml(item.product.price)}</div>
                        ${noteInput}
                    </div>
                    <div class="kit-qty">
                        <button class="qty-btn" data-index="${i}" data-delta="-1">−</button>
                        <span class="qty-val">${item.qty}</span>
                        <button class="qty-btn" data-index="${i}" data-delta="1">+</button>
                    </div>
                    ${subBtn}
                    <button class="del-btn" data-index="${i}" title="ลบ">✕</button>
                </div>`;
        }).join('');
    }

    updateKitOutput();
}

function updateNote(index, value) {
    kitItems[index].note = value;
    updateKitOutput();
}

function updateKitOutput() {
    document.getElementById('kit-output').value =
        kitItems.length === 0 ? '' : getKitText();
}

function getKitText() {
    return kitItems.map(({ product, name, qty, isPlaceholder, note, isSubstitute }, i) => {
        const num     = i + 1;
        const noteStr = note && note.trim() ? `note: ${note.trim()}\n` : '';
        const subTag  = isSubstitute ? ' [ทดแทน]' : '';
        if (isPlaceholder) {
            const qtyStr = qty > 1 ? ` (x${qty})` : '';
            return `${num}. ${name}${qtyStr}${subTag}\nไม่มีสินค้า\n${noteStr}--------------`;
        }
        const displayName = qty > 1 ? `${product.name} (x${qty})` : product.name;
        return `${num}. ${displayName}${subTag}\n${product.price}\n${noteStr}${product.product_url}\n--------------`;
    }).join('\n');
}

function copyToClipboard() {
    const text = getKitText();
    if (!text) { showToast('ยังไม่มีสินค้าใน Kit List'); return; }
    navigator.clipboard.writeText(text)
        .then(() => showToast('✓ Copy แล้ว! วาง Line ได้เลย'))
        .catch(() => {
            document.getElementById('kit-output').select();
            document.execCommand('copy');
            showToast('✓ Copy แล้ว!');
        });
}

// ── Preview Panel ─────────────────────────────────────────────────────────────
function showPreview(pid) {
    const product = productMap[String(pid)] || vectorResults.find(r => String(r.id) === String(pid));
    if (!product || !product.product_url) return;
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(product.product_url)}`;
    document.getElementById('preview-iframe').src = proxyUrl;
    document.getElementById('preview-title').textContent = product.name;
    document.getElementById('preview-ext').href = product.product_url;
    document.getElementById('preview-panel').classList.add('open');
}

function closePreview() {
    document.getElementById('preview-panel').classList.remove('open');
    setTimeout(() => { document.getElementById('preview-iframe').src = ''; }, 300);
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escAttr(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');
}

let toastTimer = null;
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ── Start ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
