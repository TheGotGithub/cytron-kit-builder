// ── State ─────────────────────────────────────────────────────────────────────
let allProducts     = [];   // full list of products
let selectedProduct = null; // current selected product object (null if none)
let compatList      = [];   // compatibility list for current product
let searchDebounce  = null;
let addDebounce     = null;
let activeTab       = 'info-tab'; // 'info-tab' or 'compat-tab'
let isEditMode      = false;      // true if editing or adding
let isAddMode       = false;      // true if creating a new product

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    await reloadAllProducts();
    bindEvents();
}

async function reloadAllProducts() {
    const res = await fetch('/api/catalog');
    const catalog = await res.json();
    allProducts = [];
    for (const cat of catalog) {
        for (const sub of cat.subcategories) {
            for (const p of sub.products) {
                allProducts.push({ ...p, category: cat.name, subcategory: sub.name });
            }
        }
    }
    renderProductList(getCurrentList());
}

function getCurrentList() {
    const q = document.getElementById('product-search').value.trim().toLowerCase();
    return q
        ? allProducts.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q) ||
            p.subcategory.toLowerCase().includes(q))
        : allProducts;
}

function bindEvents() {
    // Search input
    document.getElementById('product-search').addEventListener('input', e => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            renderProductList(getCurrentList());
        }, 200);
    });

    // Sidebar list click
    document.getElementById('product-list').addEventListener('click', e => {
        const item = e.target.closest('.product-list-item');
        if (item) {
            if (isEditMode) {
                if (!confirm('คุณมีการแก้ไขที่ยังไม่ได้บันทึก ต้องการเปลี่ยนสินค้าโดยไม่บันทึกหรือไม่?')) {
                    return;
                }
            }
            selectProduct(Number(item.dataset.id));
        }
    });

    // Add product button in sidebar
    document.getElementById('add-product-btn').addEventListener('click', () => {
        if (isEditMode) {
            if (!confirm('คุณมีการแก้ไขที่ยังไม่ได้บันทึก ต้องการเริ่มเพิ่มสินค้าใหม่หรือไม่?')) {
                return;
            }
        }
        startAddProduct();
    });

    // Delete modal confirmation
    document.getElementById('confirm-delete-btn').addEventListener('click', deleteProduct);
    document.getElementById('cancel-delete-btn').addEventListener('click', closeDeleteModal);
}

// ── Render Sidebar List ───────────────────────────────────────────────────────
function renderProductList(products) {
    const el = document.getElementById('product-list');
    if (products.length === 0) {
        el.innerHTML = '<div class="empty" style="padding:24px">ไม่พบสินค้า</div>';
        return;
    }
    el.innerHTML = products.map(p => {
        const thumb = p.image_url
            ? `<img class="list-thumb" src="${escAttr(p.image_url)}" alt="" loading="lazy" onerror="this.replaceWith(makePh('list-thumb-ph'))">`
            : `<div class="list-thumb-ph">📦</div>`;
        const isActive = selectedProduct && selectedProduct.id === p.id && !isAddMode;
        return `
            <div class="product-list-item ${isActive ? 'active' : ''}" data-id="${p.id}">
                ${thumb}
                <div class="list-info">
                    <div class="list-name">${escHtml(p.name)}</div>
                    <div class="list-sub">${escHtml(p.subcategory)}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ── Select Product ────────────────────────────────────────────────────────────
async function selectProduct(id) {
    isEditMode = false;
    isAddMode = false;
    
    // Fetch full product details from DB
    const res = await fetch(`/api/products/${id}`);
    if (!res.ok) {
        showToast('ไม่สามารถดึงข้อมูลสินค้าได้');
        return;
    }
    selectedProduct = await res.json();
    
    // Fetch compatibility list
    const compatRes = await fetch(`/api/compatibility/${id}`);
    compatList = await compatRes.json();

    renderProductList(getCurrentList());
    renderMainPanel();
}

// ── Start Add Product Mode ────────────────────────────────────────────────────
function startAddProduct() {
    selectedProduct = {
        name: '',
        category: '',
        subcategory: '',
        price: '',
        product_url: '',
        image_url: '',
        cat_order: 0,
        subcat_order: 0,
        prod_order: 0
    };
    isEditMode = true;
    isAddMode = true;
    activeTab = 'info-tab';
    renderProductList(getCurrentList()); // Remove active state in list
    renderMainPanel();
}

// ── Render Main Panel ──────────────────────────────────────────────────────────
function renderMainPanel() {
    const main = document.getElementById('compat-main');
    if (!selectedProduct) {
        main.innerHTML = `
            <div class="placeholder">
                <div class="ph-icon">⚙️</div>
                <div>เลือกสินค้าทางซ้าย<br>หรือกดปุ่ม "+ เพิ่มสินค้า" เพื่อจัดการ</div>
            </div>
        `;
        return;
    }

    const p = selectedProduct;
    
    main.innerHTML = `
        <!-- Header Info Card -->
        ${!isAddMode ? `
        <div class="flashcard">
            ${p.image_url 
                ? `<img class="card-img" src="${escAttr(p.image_url)}" alt="" onerror="this.replaceWith(makePh('card-img-ph','2rem'))">`
                : `<div class="card-img-ph">📦</div>`
            }
            <div class="card-info">
                <div class="card-name">${escHtml(p.name)}</div>
                <div class="card-sub">${escHtml(p.category)} › ${escHtml(p.subcategory)}</div>
                <div class="card-price">${p.price ? escHtml(p.price) : 'ไม่ระบุราคา'}</div>
                ${p.product_url ? `<a class="card-url" href="${escAttr(p.product_url)}" target="_blank" rel="noopener">${escHtml(p.product_url)}</a>` : ''}
            </div>
        </div>
        ` : `
        <div class="flashcard">
            <div class="card-img-ph">✨</div>
            <div class="card-info">
                <div class="card-name" style="color: var(--primary);">เพิ่มสินค้าใหม่</div>
                <div class="card-sub">กรอกรายละเอียดเพื่อลงทะเบียนสินค้าเข้าสู่ระบบ</div>
            </div>
        </div>
        `}

        <!-- Tab Navigation -->
        <div class="tabs-nav">
            <button class="tab-link ${activeTab === 'info-tab' ? 'active' : ''}" id="tab-btn-info" data-tab="info-tab">ข้อมูลสินค้า</button>
            <button class="tab-link ${activeTab === 'compat-tab' ? 'active' : ''}" id="tab-btn-compat" data-tab="compat-tab" ${isAddMode ? 'disabled style="opacity:0.4; cursor:not-allowed;" title="ต้องบันทึกสินค้าก่อนผูกข้อมูล"' : ''}>Compatibility</button>
        </div>

        <!-- Tab: Product Info -->
        <div class="tab-content ${activeTab === 'info-tab' ? 'active' : ''}" id="tab-info">
            <div class="info-form-card">
                <div class="form-grid">
                    <div class="form-group form-grid-full">
                        <label>ชื่อสินค้า / Product Name</label>
                        ${isEditMode 
                            ? `<input type="text" class="form-control" id="inp-name" value="${escAttr(p.name)}" placeholder="ชื่อสินค้า...">`
                            : `<div class="read-only-val">${escHtml(p.name)}</div>`
                        }
                    </div>

                    <div class="form-group">
                        <label>หมวดหมู่หลัก / Category</label>
                        ${isEditMode 
                            ? `<input type="text" class="form-control" id="inp-category" value="${escAttr(p.category)}" placeholder="เช่น Raspberry Pi, เซนเซอร์...">`
                            : `<div class="read-only-val">${escHtml(p.category)}</div>`
                        }
                    </div>

                    <div class="form-group">
                        <label>หมวดหมู่ย่อย / Subcategory</label>
                        ${isEditMode 
                            ? `<input type="text" class="form-control" id="inp-subcategory" value="${escAttr(p.subcategory)}" placeholder="เช่น บอร์ดทดแทน Arduino...">`
                            : `<div class="read-only-val">${escHtml(p.subcategory)}</div>`
                        }
                    </div>

                    <div class="form-group">
                        <label>ราคา / Price</label>
                        ${isEditMode 
                            ? `<input type="text" class="form-control" id="inp-price" value="${escAttr(p.price)}" placeholder="เช่น THB1,200.00...">`
                            : `<div class="read-only-val ${!p.price ? 'empty' : ''}">${p.price ? escHtml(p.price) : 'ไม่มีข้อมูล'}</div>`
                        }
                    </div>

                    <div class="form-group">
                        <label>ลำดับหมวดหมู่หลัก (Cat Order)</label>
                        ${isEditMode 
                            ? `<input type="number" class="form-control" id="inp-cat-order" value="${p.cat_order}">`
                            : `<div class="read-only-val">${p.cat_order}</div>`
                        }
                    </div>

                    <div class="form-group">
                        <label>ลำดับหมวดหมู่ย่อย (Subcat Order)</label>
                        ${isEditMode 
                            ? `<input type="number" class="form-control" id="inp-subcat-order" value="${p.subcat_order}">`
                            : `<div class="read-only-val">${p.subcat_order}</div>`
                        }
                    </div>

                    <div class="form-group">
                        <label>ลำดับสินค้า (Prod Order)</label>
                        ${isEditMode 
                            ? `<input type="number" class="form-control" id="inp-prod-order" value="${p.prod_order}">`
                            : `<div class="read-only-val">${p.prod_order}</div>`
                        }
                    </div>

                    <div class="form-group form-grid-full">
                        <label>ลิงก์สินค้า / Product URL</label>
                        ${isEditMode 
                            ? `<input type="url" class="form-control" id="inp-product-url" value="${escAttr(p.product_url)}" placeholder="https://th.cytron.io/...">`
                            : `<div class="read-only-val ${!p.product_url ? 'empty' : ''}">
                                ${p.product_url ? `<a href="${escAttr(p.product_url)}" target="_blank">${escHtml(p.product_url)}</a>` : 'ไม่มีข้อมูล'}
                               </div>`
                        }
                    </div>

                    <div class="form-group form-grid-full">
                        <label>ลิงก์รูปภาพ / Image URL</label>
                        ${isEditMode 
                            ? `<input type="url" class="form-control" id="inp-image-url" value="${escAttr(p.image_url)}" placeholder="https://static.cytron.io/...">`
                            : `<div class="read-only-val ${!p.image_url ? 'empty' : ''}">
                                ${p.image_url ? `<a href="${escAttr(p.image_url)}" target="_blank">${escHtml(p.image_url)}</a>` : 'ไม่มีข้อมูล'}
                               </div>`
                        }
                    </div>
                </div>

                <div class="form-actions">
                    ${isEditMode ? `
                        <button class="btn-action btn-save" id="save-btn">บันทึก</button>
                        <button class="btn-action btn-cancel" id="cancel-btn">ยกเลิก</button>
                    ` : `
                        <button class="btn-action btn-edit" id="edit-btn">แก้ไข</button>
                        <button class="btn-action btn-delete" id="delete-btn">ลบสินค้า</button>
                    `}
                </div>
            </div>
        </div>

        <!-- Tab: Compatibility -->
        <div class="tab-content ${activeTab === 'compat-tab' ? 'active' : ''}" id="tab-compat">
            <!-- Add link box -->
            <div class="add-link-box">
                <div class="add-link-title">+ เพิ่ม Compatibility</div>
                <div class="add-link-row">
                    <input type="search" class="add-link-input" id="add-search"
                           placeholder="ค้นหาสินค้าที่ใช้ร่วมกันได้..." autocomplete="off">
                </div>
                <div class="add-search-results" id="add-results"></div>
            </div>

            <!-- Compatible list -->
            <div class="compat-section-header">
                <span class="compat-section-title">สินค้าที่ใช้ร่วมกันได้</span>
                <span class="compat-count" id="compat-count">${compatList.length} รายการ</span>
            </div>
            <div id="compat-list">
                ${compatList.length === 0
                    ? `<div class="compat-empty">ยังไม่มี Compatibility<br>เพิ่มจากช่องด้านบน</div>`
                    : `<div class="compat-grid">${compatList.map(c => renderCompatItem(c)).join('')}</div>`
                }
            </div>
        </div>
    `;

    bindTabEvents();
}

function renderCompatItem(c) {
    const thumb = c.image_url
        ? `<img class="compat-thumb" src="${escAttr(c.image_url)}" alt="" onerror="this.replaceWith(makePh('compat-thumb-ph','1.2rem'))">`
        : `<div class="compat-thumb-ph">📦</div>`;

    return `
        <div class="compat-item">
            ${thumb}
            <div class="compat-info">
                <div class="compat-name" title="${escAttr(c.name)}">${escHtml(c.name)}</div>
                <div class="compat-price">${c.price ? escHtml(c.price) : 'ไม่ระบุราคา'}</div>
                ${c.notes ? `<div class="notes-badge">${escHtml(c.notes)}</div>` : ''}
            </div>
            <button class="unlink-btn" data-id="${c.id}" title="ยกเลิก Link">✕</button>
        </div>
    `;
}

function bindTabEvents() {
    // Tab switching
    document.getElementById('tab-btn-info').addEventListener('click', () => switchTab('info-tab'));
    
    const tabCompat = document.getElementById('tab-btn-compat');
    if (!tabCompat.disabled) {
        tabCompat.addEventListener('click', () => switchTab('compat-tab'));
    }

    if (isEditMode) {
        // Save form
        document.getElementById('save-btn').addEventListener('click', saveProduct);
        // Cancel edit
        document.getElementById('cancel-btn').addEventListener('click', cancelEdit);
    } else {
        // Edit mode toggle
        document.getElementById('edit-btn').addEventListener('click', () => {
            isEditMode = true;
            renderMainPanel();
        });
        // Delete button
        document.getElementById('delete-btn').addEventListener('click', openDeleteModal);
    }

    // Compatibility sub-tab listeners
    if (activeTab === 'compat-tab' && !isAddMode) {
        // Search link autocompletion
        document.getElementById('add-search').addEventListener('input', e => {
            clearTimeout(addDebounce);
            const q = e.target.value.trim();
            if (!q) {
                document.getElementById('add-results').classList.remove('open');
                return;
            }
            addDebounce = setTimeout(() => fetchAddSearch(q), 250);
        });

        // Unlink buttons
        document.getElementById('compat-list').addEventListener('click', e => {
            const btn = e.target.closest('.unlink-btn');
            if (btn) unlinkProduct(Number(btn.dataset.id));
        });

        // Click outside search results
        document.addEventListener('click', e => {
            if (!e.target.closest('.add-link-box')) {
                const resEl = document.getElementById('add-results');
                if (resEl) resEl.classList.remove('open');
            }
        });
    }
}

function switchTab(tabId) {
    activeTab = tabId;
    renderMainPanel();
}

// ── CRUD Actions ──────────────────────────────────────────────────────────────
async function saveProduct() {
    const name = document.getElementById('inp-name').value.trim();
    const category = document.getElementById('inp-category').value.trim();
    const subcategory = document.getElementById('inp-subcategory').value.trim();
    
    if (!name || !category || !subcategory) {
        showToast('กรุณากรอกข้อมูลฟิลด์บังคับให้ครบ (ชื่อสินค้า, หมวดหมู่หลัก, หมวดหมู่ย่อย)');
        return;
    }

    const payload = {
        name,
        category,
        subcategory,
        price: document.getElementById('inp-price').value.trim(),
        product_url: document.getElementById('inp-product-url').value.trim(),
        image_url: document.getElementById('inp-image-url').value.trim(),
        cat_order: parseInt(document.getElementById('inp-cat-order').value) || 0,
        subcat_order: parseInt(document.getElementById('inp-subcat-order').value) || 0,
        prod_order: parseInt(document.getElementById('inp-prod-order').value) || 0
    };

    if (isAddMode) {
        // POST to create
        const res = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            showToast('✓ เพิ่มสินค้าสำเร็จ');
            isAddMode = false;
            isEditMode = false;
            await reloadAllProducts();
            await selectProduct(data.id);
        } else {
            showToast('ผิดพลาด: ' + (data.error || 'ไม่รู้จัก'));
        }
    } else {
        // PUT to update
        const res = await fetch(`/api/products/${selectedProduct.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            showToast('✓ บันทึกการแก้ไขสำเร็จ');
            isEditMode = false;
            await reloadAllProducts();
            await selectProduct(selectedProduct.id);
        } else {
            showToast('ผิดพลาด: ' + (data.error || 'ไม่รู้จัก'));
        }
    }
}

function cancelEdit() {
    isEditMode = false;
    if (isAddMode) {
        isAddMode = false;
        selectedProduct = null;
    }
    renderProductList(getCurrentList());
    renderMainPanel();
}

async function deleteProduct() {
    if (!selectedProduct || isAddMode) return;
    
    const id = selectedProduct.id;
    const res = await fetch(`/api/products/${id}`, {
        method: 'DELETE'
    });
    const data = await res.json();
    
    closeDeleteModal();
    
    if (res.ok && data.ok) {
        showToast('ลบสินค้าสำเร็จ');
        selectedProduct = null;
        await reloadAllProducts();
        renderMainPanel();
    } else {
        showToast('ผิดพลาด: ' + (data.error || 'ไม่รู้จัก'));
    }
}

function openDeleteModal() {
    document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.remove('open');
}

// ── Compatibility sub-tab details ─────────────────────────────────────────────
async function fetchAddSearch(q) {
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    const linkedIds = new Set(compatList.map(c => c.id));
    const results   = data.filter(p => p.id !== selectedProduct.id);

    const el = document.getElementById('add-results');
    if (results.length === 0) {
        el.innerHTML = '<div class="empty" style="padding:12px;font-size:0.78rem">ไม่พบสินค้า</div>';
        el.classList.add('open');
        return;
    }

    el.innerHTML = results.map(p => {
        const linked = linkedIds.has(p.id);
        const thumb  = p.image_url
            ? `<img class="sr-thumb" src="${escAttr(p.image_url)}" alt="">`
            : `<div class="sr-thumb-ph">📦</div>`;
        return `
            <div class="search-result-item ${linked ? 'already-linked' : ''}" data-id="${p.id}">
                ${thumb}
                <div>
                    <div class="sr-name">${escHtml(p.name)}</div>
                    <div class="sr-sub">${escHtml(p.subcategory)}${linked ? ' — เชื่อมแล้ว' : ''}</div>
                </div>
            </div>
        `;
    }).join('');
    el.classList.add('open');

    el.querySelectorAll('.search-result-item:not(.already-linked)').forEach(item => {
        item.addEventListener('click', () => linkProduct(Number(item.dataset.id)));
    });
}

async function linkProduct(targetId) {
    const res = await fetch('/api/compatibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            product_id_a: selectedProduct.id,
            product_id_b: targetId,
        }),
    });
    const data = await res.json();
    if (!data.ok) { showToast('เชื่อมไม่ได้: ' + data.error); return; }

    const addSearchInput = document.getElementById('add-search');
    if (addSearchInput) addSearchInput.value = '';
    const addResults = document.getElementById('add-results');
    if (addResults) addResults.classList.remove('open');

    const fresh = await fetch(`/api/compatibility/${selectedProduct.id}`);
    compatList  = await fresh.json();
    refreshCompatSection();
    showToast('✓ เชื่อม Compatibility แล้ว');
}

async function unlinkProduct(targetId) {
    const res = await fetch('/api/compatibility', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            product_id_a: selectedProduct.id,
            product_id_b: targetId,
        }),
    });
    const data = await res.json();
    if (!data.ok) { showToast('ลบไม่ได้: ' + data.error); return; }

    const fresh = await fetch(`/api/compatibility/${selectedProduct.id}`);
    compatList  = await fresh.json();
    refreshCompatSection();
    showToast('ยกเลิก Link แล้ว');
}

function refreshCompatSection() {
    document.getElementById('compat-count').textContent = `${compatList.length} รายการ`;
    const listEl = document.getElementById('compat-list');
    listEl.innerHTML = compatList.length === 0
        ? `<div class="compat-empty">ยังไม่มี Compatibility<br>เพิ่มจากช่องด้านบน</div>`
        : `<div class="compat-grid">${compatList.map(c => renderCompatItem(c)).join('')}</div>`;

    listEl.querySelectorAll('.unlink-btn').forEach(btn => {
        btn.addEventListener('click', () => unlinkProduct(Number(btn.dataset.id)));
    });
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function makePh(cls = 'product-img-ph', size = '2rem') {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = '📦';
    if (size) d.style.fontSize = size;
    return d;
}

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escAttr(str) {
    return String(str ?? '')
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

document.addEventListener('DOMContentLoaded', init);
