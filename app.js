/* ================================================================
   BỆNH VIỆN PHỤ SẢN HẢI PHÒNG — Medical Protocol SPA
   app.js — Single Page Application Logic
   ================================================================ */

/* ================================================================
   CONFIGURATION — THAY URL APPS SCRIPT VÀO ĐÂY
   ================================================================ */
const CONFIG = {
  // Sau khi deploy Google Apps Script, copy URL vào đây
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyboc1dwgcWAmcMPsBrYifusfel3bJt22Nf9rXfqUA/dev',
  ADMIN_TOKEN_KEY: 'medpro_admin_token',
  VERSION: '1.0.0'
};

/* ================================================================
   STATE — Trạng thái toàn cục ứng dụng
   ================================================================ */
const state = {
  view:              'home',      // 'home' | 'conditions' | 'protocol' | 'admin-login' | 'admin'
  depts:             null,
  conditions:        null,
  protocol:          null,
  selectedDept:      null,
  selectedCondition: null,
  activeDay:         0,           // Index tab ngày đang xem
  adminToken:        null,
  adminView:         'depts',     // Tab admin hiện tại
  adminEditItem:     null,        // Item đang sửa trong admin
  adminFilterDept:   '',          // Filter khoa trong admin protocol
  adminFilterCond:   '',          // Filter bệnh trong admin protocol
  adminDepts:        null,        // Cache danh sách cho admin
  adminConditions:   null,
  adminProtocols:    null,
  modalCallback:     null,
  toastTimer:        null
};

/* ================================================================
   CACHE — Bộ nhớ đệm phía client
   ================================================================ */
const Cache = {
  get(key) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (e) {
      return null;
    }
  },
  set(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
  },
  clear() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('medpro_cache_')) {
        localStorage.removeItem(key);
      }
    }
  }
};

/* ================================================================
   API — Giao tiếp với Google Apps Script
   ================================================================ */
const API = {

  async get(action, params = {}) {
    try {
      const qs = new URLSearchParams({ action, ...params }).toString();
      const resp = await fetch(`${CONFIG.SCRIPT_URL}?${qs}`, {
        method: 'GET',
        redirect: 'follow'
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.json();
    } catch (err) {
      console.error('[API GET] Error:', err);
      return { success: false, error: 'Lỗi kết nối: ' + err.message };
    }
  },

  async post(action, data = {}) {
    try {
      const body = JSON.stringify({
        action,
        token: state.adminToken,
        ...data
      });
      const resp = await fetch(CONFIG.SCRIPT_URL, {
        method: 'POST',
        // Dùng text/plain để tránh CORS preflight với Google Apps Script
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        redirect: 'follow'
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.json();
    } catch (err) {
      console.error('[API POST] Error:', err);
      return { success: false, error: 'Lỗi kết nối: ' + err.message };
    }
  },

  async getDepts() {
    return this.get('getDepts');
  },

  async getConditions(deptId) {
    return this.get('getConditions', { deptId });
  },

  async getProtocol(condId) {
    return this.get('getProtocol', { condId });
  },

  async login(password) {
    const hash = await sha256(password);
    return this.post('login', { passwordHash: hash, token: undefined });
  },

  async logout() {
    const res = await this.post('logout');
    return res;
  },

  async saveDept(item)      { return this.post('saveDept', { item }); },
  async deleteDept(id)      { return this.post('deleteDept', { id }); },
  async saveCondition(item) { return this.post('saveCondition', { item }); },
  async deleteCondition(id) { return this.post('deleteCondition', { id }); },
  async saveProtocol(item)  { return this.post('saveProtocol', { item }); },
  async deleteProtocol(id)  { return this.post('deleteProtocol', { id }); },
  async changePassword(newPassword) {
    const hash = await sha256(newPassword);
    return this.post('changePassword', { newHash: hash });
  }
};

/* ================================================================
   SHA-256 Utility (Web Crypto API — built-in)
   ================================================================ */
async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ================================================================
   UTILS
   ================================================================ */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2list(text) {
  if (!text || !String(text).trim()) return '<span class="text-muted">—</span>';
  const lines = String(text).split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 1) return `<span>${escHtml(lines[0])}</span>`;
  return '<ul>' + lines.map(l => `<li>${escHtml(l)}</li>`).join('') + '</ul>';
}

function severityLabel(s) {
  return s === 'high' ? 'Cao' : s === 'medium' ? 'Trung bình' : 'Thấp';
}

function severityClass(s) {
  return `badge badge-${s || 'low'}`;
}

function parseProtocolSections(p) {
  if (!p) return [];
  let assessmentStr = String(p.assessment || '').trim();
  if (assessmentStr.startsWith('[') && assessmentStr.endsWith(']')) {
    try {
      return JSON.parse(assessmentStr);
    } catch (e) {
      console.error('Lỗi parse JSON trong assessment:', e);
    }
  }
  return [
    { title: 'Thăm Khám, Đánh Giá', content: p.assessment || '' },
    { title: 'Cận Lâm Sàng',           content: p.labTests || '' },
    { title: 'Điều Trị',                  content: p.treatment || '' },
    { title: 'Dinh Dưỡng & Sinh Hoạt',   content: p.nutrition || '' },
    { title: 'Truyền Thông',              content: p.communication || '' }
  ];
}

function getSectionStyle(title) {
  const t = String(title || '').toLowerCase();
  if (t.includes('khám') || t.includes('đánh giá') || (t.includes('lâm sàng') && !t.includes('cận'))) {
    return { cls: 'col-assess', icon: iconStethoscope() };
  }
  if (t.includes('xét nghiệm') || t.includes('cận lâm sàng') || t.includes('siêu âm') || t.includes('x-quang') || t.includes('ctg') || t.includes('chiếu chụp')) {
    return { cls: 'col-lab', icon: iconLab() };
  }
  if (t.includes('thuốc') || t.includes('điều trị') || t.includes('phác đồ') || t.includes('dùng thuốc')) {
    return { cls: 'col-treat', icon: iconPill() };
  }
  if (t.includes('dinh dưỡng') || t.includes('ăn uống') || t.includes('sinh hoạt') || t.includes('nghỉ ngơi') || t.includes('vận động')) {
    return { cls: 'col-nutri', icon: iconNutrition() };
  }
  if (t.includes('truyền thông') || t.includes('tư vấn') || t.includes('hướng dẫn') || t.includes('giải thích')) {
    return { cls: 'col-comm', icon: iconComm() };
  }
  return { cls: 'col-assess', icon: iconList() };
}

function iconList() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
}

/* ================================================================
   APP — Main Application
   ================================================================ */
const App = {

  /* ---------- INIT ---------- */
  async init() {
    // Khôi phục admin token nếu có
    state.adminToken = sessionStorage.getItem(CONFIG.ADMIN_TOKEN_KEY) || null;



    // Render trang chủ
    await this.navigate('home');
  },

  /* ---------- NAVIGATION ---------- */
  async navigate(view, params = {}) {
    state.view = view;
    if (params.dept)      state.selectedDept      = params.dept;
    if (params.condition) state.selectedCondition  = params.condition;

    this.render();
  },

  goBack() {
    const v = state.view;
    if (v === 'conditions') this.navigate('home');
    else if (v === 'protocol') this.navigate('conditions');
    else if (v === 'admin') this.navigate('admin-login');
    else this.navigate('home');
  },

  /* ---------- RENDER ---------- */
  render() {
    const main = document.getElementById('app-main');
    main.classList.add('hidden');
    this.updateHeader();

    let html = '';
    switch (state.view) {
      case 'home':        html = this.renderHome();       break;
      case 'conditions':  html = this.renderConditions(); break;
      case 'protocol':    html = this.renderProtocol();   break;
      case 'admin-login': html = this.renderAdminLogin(); break;
      case 'admin':       html = this.renderAdmin();      break;
      default:            html = this.renderHome();
    }

    main.innerHTML = html;
    // Fade-in
    requestAnimationFrame(() => {
      main.classList.remove('hidden');
      this.initCustomSelects();
    });

    // Trigger data load sau khi DOM sẵn sàng
    this.afterRender();
  },

  updateHeader() {
    const btnBack    = document.getElementById('btn-back');
    const breadcrumb = document.getElementById('breadcrumb');
    const bcDept     = document.getElementById('bc-dept');
    const bcCond     = document.getElementById('bc-cond');
    const bcSep1     = document.getElementById('bc-sep1');
    const btnAdmin   = document.getElementById('btn-admin-link');
    const appEl      = document.getElementById('app');

    const v = state.view;

    // Back button
    const showBack = ['conditions', 'protocol', 'admin'].includes(v);
    btnBack.classList.toggle('hidden', !showBack);

    // Admin link — ẩn khi đang ở admin
    btnAdmin.classList.toggle('hidden', v === 'admin-login' || v === 'admin');

    // Breadcrumb
    const showBreadcrumb = ['conditions', 'protocol'].includes(v);
    breadcrumb.classList.toggle('hidden', !showBreadcrumb);
    appEl.classList.toggle('has-breadcrumb', showBreadcrumb);

    if (showBreadcrumb && state.selectedDept) {
      bcDept.textContent = state.selectedDept.name;
      bcDept.classList.remove('hidden');
      bcSep1.classList.toggle('hidden', v !== 'protocol');
      bcCond.classList.toggle('hidden', v !== 'protocol');

      if (v === 'protocol' && state.selectedCondition) {
        bcCond.textContent = state.selectedCondition.name;
        bcCond.classList.add('active');
      }
    }
  },

  afterRender() {
    const v = state.view;
    if (v === 'home')       this.loadDepts();
    if (v === 'conditions') this.loadConditions();
    if (v === 'protocol')   this.loadProtocol();
    if (v === 'admin')      this.loadAdminData();
  },

  /* ================================================================
     PAGE: HOME — Chọn Khoa
     ================================================================ */
  renderHome() {
    return `
      <div class="page-header">
        <h1 class="page-title">Chọn Khoa</h1>
        <p class="page-subtitle">Chọn khoa bạn đang làm việc để xem phiếu điều trị</p>
      </div>
      <div id="dept-grid" class="card-grid">
        ${this.renderLoading()}
      </div>
    `;
  },

  async loadDepts() {
    const grid = document.getElementById('dept-grid');
    if (!grid) return;

    const cacheKey = 'medpro_cache_depts';
    const cached = Cache.get(cacheKey);
    if (cached) {
      state.depts = cached;
      this.renderDeptsGrid(grid, cached);
    } else {
      grid.innerHTML = this.renderLoading();
    }

    const res = await API.getDepts();
    if (res.success && res.data) {
      const freshData = res.data;
      const dataChanged = JSON.stringify(cached) !== JSON.stringify(freshData);
      Cache.set(cacheKey, freshData);
      state.depts = freshData;
      if (dataChanged || !cached) {
        this.renderDeptsGrid(grid, freshData);
      }
    } else if (!cached) {
      grid.innerHTML = this.renderError('Không thể tải danh sách khoa. Vui lòng kiểm tra kết nối.');
    }
  },

  renderDeptsGrid(grid, depts) {
    if (!depts.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>
          <p>Chưa có khoa nào được thêm.</p>
          <button class="btn btn-primary btn-sm" onclick="App.navigate('admin-login')">Vào Admin để thêm</button>
        </div>`;
      return;
    }

    grid.innerHTML = depts.map(d => `
      <div class="dept-card" style="--dept-color:${escHtml(d.color || '#2D2B8C')}"
           onclick="App.selectDept(${escHtml(JSON.stringify(d))})">
        <div class="dept-card-name">${escHtml(d.name)}</div>
        ${d.description ? `<div class="dept-card-desc">${escHtml(d.description)}</div>` : ''}
        <svg class="dept-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    `).join('');
  },

  selectDept(deptObj) {
    // deptObj có thể là string (từ onclick) hoặc object
    const dept = typeof deptObj === 'string' ? JSON.parse(deptObj) : deptObj;
    state.selectedDept = dept;
    state.conditions = null;
    this.navigate('conditions', { dept });
  },

  /* ================================================================
     PAGE: CONDITIONS — Chọn Bệnh Lý
     ================================================================ */
  renderConditions() {
    return `
      <div class="page-header">
        <h1 class="page-title">${escHtml(state.selectedDept?.name || 'Bệnh lý')}</h1>
        <p class="page-subtitle">Chọn vấn đề bệnh lý cần tra cứu</p>
      </div>
      <div id="cond-list" class="cond-list">
        ${this.renderLoading()}
      </div>
    `;
  },

  async loadConditions() {
    const list = document.getElementById('cond-list');
    if (!list || !state.selectedDept) return;

    const cacheKey = `medpro_cache_conditions_${state.selectedDept.id}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
      state.conditions = cached;
      this.renderConditionsList(list, cached);
    } else {
      list.innerHTML = this.renderLoading();
    }

    const res = await API.getConditions(state.selectedDept.id);
    if (res.success && res.data) {
      const freshData = res.data;
      const dataChanged = JSON.stringify(cached) !== JSON.stringify(freshData);
      Cache.set(cacheKey, freshData);
      state.conditions = freshData;
      if (dataChanged || !cached) {
        this.renderConditionsList(list, freshData);
      }
    } else if (!cached) {
      list.innerHTML = this.renderError('Không thể tải danh sách bệnh lý.');
    }
  },

  renderConditionsList(list, conditions) {
    if (!conditions.length) {
      list.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p>Chưa có bệnh lý nào cho khoa này.</p>
        </div>`;
      return;
    }

    list.innerHTML = conditions.map(c => {
      const sevColors = { high: '#B91C1C', medium: '#B45309', low: '#0F7B55' };
      const color = sevColors[c.severity] || sevColors.low;
      return `
        <div class="cond-card" style="--sev-color:${color}"
             onclick="App.selectCondition(${escHtml(JSON.stringify(c))})">
          <div class="cond-card-body">
            <div class="cond-card-name">${escHtml(c.name)}</div>
            ${c.shortDesc ? `<div class="cond-card-desc">${escHtml(c.shortDesc)}</div>` : ''}
          </div>
          <span class="${severityClass(c.severity)}">${severityLabel(c.severity)}</span>
        </div>
      `;
    }).join('');
  },

  selectCondition(condObj) {
    const cond = typeof condObj === 'string' ? JSON.parse(condObj) : condObj;
    state.selectedCondition = cond;
    state.protocol = null;
    state.activeDay = 0;
    this.navigate('protocol', { condition: cond });
  },

  /* ================================================================
     PAGE: PROTOCOL — Xem Mẫu Phiếu
     ================================================================ */
  renderProtocol() {
    const cond = state.selectedCondition;
    if (!cond) return this.renderHome();

    return `
      <div class="protocol-header">
        <h1 class="protocol-title">${escHtml(cond.name)}</h1>
        <div class="protocol-dept-label">
          ${escHtml(state.selectedDept?.name || '')}
          &nbsp;·&nbsp;
          <span class="${severityClass(cond.severity)} protocol-sev-badge">${severityLabel(cond.severity)}</span>
        </div>
      </div>
      <div id="protocol-tabs" class="day-tabs">
        ${this.renderLoading('inline')}
      </div>
      <div id="protocol-cards" class="protocol-cards">
      </div>
    `;
  },

  async loadProtocol() {
    if (!state.selectedCondition) return;

    const tabsEl  = document.getElementById('protocol-tabs');
    const cardsEl = document.getElementById('protocol-cards');
    if (!tabsEl || !cardsEl) return;

    const cacheKey = `medpro_cache_protocol_${state.selectedCondition.id}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
      state.protocol = cached;
      this.renderProtocolTabs();
    } else {
      tabsEl.innerHTML  = this.renderLoading('inline');
      cardsEl.innerHTML = '';
    }

    const res = await API.getProtocol(state.selectedCondition.id);
    if (res.success && res.data) {
      const freshData = res.data;
      const dataChanged = JSON.stringify(cached) !== JSON.stringify(freshData);
      Cache.set(cacheKey, freshData);
      state.protocol = freshData;
      if (dataChanged || !cached) {
        if (state.activeDay >= freshData.length) {
          state.activeDay = 0;
        }
        this.renderProtocolTabs();
      }
    } else if (!cached) {
      tabsEl.innerHTML  = '';
      cardsEl.innerHTML = this.renderError('Không thể tải phiếu điều trị.');
    }
  },

  renderProtocolTabs() {
    const tabsEl  = document.getElementById('protocol-tabs');
    const cardsEl = document.getElementById('protocol-cards');
    if (!tabsEl || !cardsEl || !state.protocol) return;

    const days = state.protocol;

    if (!days.length) {
      tabsEl.innerHTML  = '';
      cardsEl.innerHTML = `
        <div class="protocol-empty">
          <p>Chưa có mẫu phiếu cho bệnh lý này.</p>
        </div>`;
      return;
    }

    // Render tabs
    tabsEl.innerHTML = days.map((d, i) => `
      <button class="day-tab ${i === state.activeDay ? 'active' : ''}"
              onclick="App.switchDay(${i})">
        ${escHtml(d.dayLabel || `Ngày ${i+1}`)}
      </button>
    `).join('');

    // Render cards cho ngày active
    const day = days[state.activeDay];
    if (!day) { cardsEl.innerHTML = ''; return; }

    const sections = parseProtocolSections(day);
    const careVal = day.careLevel;
    const careIsEmpty = !careVal || !String(careVal).trim();

    let cardsHtml = sections.map(sec => {
      const style = getSectionStyle(sec.title);
      const val = sec.content;
      const isEmpty = !val || !String(val).trim();

      return `
        <div class="proto-card">
          <div class="proto-card-header ${style.cls}">
            ${style.icon} ${escHtml(sec.title)}
          </div>
          <div class="proto-card-body">
            ${isEmpty ? '<span class="text-muted">Không có nội dung</span>' : nl2list(val)}
          </div>
        </div>`;
    }).join('');

    // Cấp độ chăm sóc hiển thị đặc biệt ở dưới cùng
    cardsHtml += `
      <div class="proto-card col-care-wrap">
        <div class="proto-card-header col-care">
          ${iconCare()} Cấp Độ Chăm Sóc
        </div>
        <div class="proto-card-body">
          <div class="care-level-value">${careIsEmpty ? '—' : escHtml(String(careVal))}</div>
        </div>
      </div>`;

    cardsEl.innerHTML = cardsHtml;

    // Scroll tabs active vào view
    const activeTab = tabsEl.querySelector('.day-tab.active');
    if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  },

  switchDay(index) {
    state.activeDay = index;
    this.renderProtocolTabs();
  },

  /* ================================================================
     PAGE: ADMIN LOGIN
     ================================================================ */
  renderAdminLogin() {
    return `
      <div class="admin-login-wrap">
        <div class="admin-login-card">
          <img src="Logo.png" alt="Logo" class="admin-login-logo" />
          <h1 class="admin-login-title">Trang Quản Trị</h1>
          <p class="admin-login-sub">Nhập mật khẩu để truy cập hệ thống quản lý</p>

          <form id="login-form" onsubmit="App.doLogin(event)">
            <div class="form-group">
              <label class="form-label" for="login-pass">Mật khẩu</label>
              <div class="input-wrap">
                <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
                <input id="login-pass" type="password" class="form-input"
                       placeholder="Nhập mật khẩu..." autocomplete="current-password" autofocus />
              </div>
            </div>
            <div id="login-err" class="text-muted mt-sm hidden" style="color:var(--danger)"></div>
            <button type="submit" class="btn btn-primary btn-full mt-base" id="login-btn">
              Đăng nhập
            </button>
          </form>

          <div class="mt-base text-center">
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('home')">
              ← Về trang chủ
            </button>
          </div>
        </div>
      </div>
    `;
  },

  async doLogin(e) {
    e.preventDefault();
    const pass = document.getElementById('login-pass').value;
    const btn  = document.getElementById('login-btn');
    const errEl = document.getElementById('login-err');

    if (!pass) { errEl.textContent = 'Vui lòng nhập mật khẩu'; errEl.classList.remove('hidden'); return; }

    btn.disabled = true;
    btn.textContent = 'Đang xác thực...';
    errEl.classList.add('hidden');

    const res = await API.login(pass);

    if (res.success && res.token) {
      state.adminToken = res.token;
      sessionStorage.setItem(CONFIG.ADMIN_TOKEN_KEY, res.token);
      this.showToast('Đăng nhập thành công!', 'success');
      this.navigate('admin');
    } else {
      errEl.textContent = res.error || 'Đăng nhập thất bại';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  },

  /* ================================================================
     PAGE: ADMIN PANEL
     ================================================================ */
  renderAdmin() {
    if (!state.adminToken) { return this.renderAdminLogin(); }

    const tabs = ['depts', 'conditions', 'protocols', 'settings'];
    const tabLabels = { depts: 'Khoa', conditions: 'Bệnh Lý', protocols: 'Mẫu Phiếu', settings: 'Cài Đặt' };

    return `
      <div class="admin-wrap">
        <div class="admin-header">
          <h1 class="admin-header-title">Trang Quản Trị</h1>
          <button class="btn btn-ghost btn-sm" onclick="App.doLogout()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Đăng xuất
          </button>
        </div>

        <div class="admin-tabs" role="tablist">
          ${tabs.map(t => `
            <button class="admin-tab ${state.adminView === t ? 'active' : ''}"
                    role="tab" onclick="App.switchAdminTab('${t}')">
              ${tabLabels[t]}
            </button>
          `).join('')}
        </div>

        <div id="admin-content">
          ${this.renderLoading()}
        </div>
      </div>
    `;
  },

  async loadAdminData() {
    await this.renderAdminTab();
  },

  switchAdminTab(tab) {
    state.adminView = tab;
    state.adminEditItem = null;
    const content = document.getElementById('admin-content');
    if (content) {
      // Update tab active
      document.querySelectorAll('.admin-tab').forEach(el => {
        el.classList.toggle('active', el.textContent.trim() === { depts: 'Khoa', conditions: 'Bệnh Lý', protocols: 'Mẫu Phiếu', settings: 'Cài Đặt' }[tab]);
      });
      content.innerHTML = this.renderLoading();
      this.renderAdminTab();
    }
  },

  async renderAdminTab() {
    const content = document.getElementById('admin-content');
    if (!content) return;

    switch (state.adminView) {
      case 'depts':      content.innerHTML = await this.buildAdminDepts();      break;
      case 'conditions': content.innerHTML = await this.buildAdminConditions(); break;
      case 'protocols':  content.innerHTML = await this.buildAdminProtocols();  break;
      case 'settings':   content.innerHTML = this.buildAdminSettings();         break;
    }

    this.initCustomSelects();
  },

  /* --- Admin: Quản lý Khoa --- */
  async buildAdminDepts() {
    const res = await API.getDepts();
    // Lấy tất cả khoa (kể cả inactive) — cần lấy trực tiếp
    const res2 = await API.get('getDepts'); // Chỉ lấy active, nên ta dùng state
    state.adminDepts = res.data || [];

    const editing = state.adminEditItem;

    return `
      <div class="add-row">
        <button class="btn btn-primary btn-sm" onclick="App.editDept(null)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Thêm Khoa mới
        </button>
      </div>

      ${editing !== undefined && editing !== 'none' ? this.renderDeptForm(editing) : ''}

      <div class="admin-list">
        ${!state.adminDepts.length ? `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>
            <p>Chưa có khoa nào. Nhấn "Thêm Khoa mới" để bắt đầu.</p>
          </div>
        ` : state.adminDepts.map(d => `
          <div class="admin-list-item">
            <div class="color-dot" style="background:${escHtml(d.color || '#2D2B8C')};margin-top:4px"></div>
            <div class="admin-list-item-body">
              <div class="admin-list-item-title">${escHtml(d.name)}</div>
              <div class="admin-list-item-meta">
                ${escHtml(d.description || '')}
                &nbsp;·&nbsp;
                <span class="status-badge ${d.active === true || String(d.active).toUpperCase() === 'TRUE' ? 'status-active' : 'status-inactive'}">
                  ${d.active === true || String(d.active).toUpperCase() === 'TRUE' ? 'Hiển thị' : 'Ẩn'}
                </span>
              </div>
            </div>
            <div class="admin-list-item-actions">
              <button class="btn btn-ghost btn-sm btn-icon" title="Sửa" onclick="App.editDept(${escHtml(JSON.stringify(d))})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn-ghost btn-sm btn-icon" title="Xóa" style="color:var(--danger)" onclick="App.confirmDelete('dept','${escHtml(d.id)}','${escHtml(d.name)}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  renderDeptForm(dept) {
    const isNew = !dept || !dept.id;
    return `
      <div class="admin-form-panel">
        <div class="admin-form-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>
          ${isNew ? 'Thêm Khoa mới' : 'Sửa Khoa: ' + escHtml(dept?.name)}
        </div>
        <form onsubmit="App.saveDeptForm(event, ${isNew ? 'null' : `'${escHtml(dept?.id)}'`})">
          <input type="hidden" id="df-id" value="${escHtml(dept?.id || '')}" />
          <div class="form-group">
            <label class="form-label">Tên Khoa <span class="req">*</span></label>
            <input type="text" id="df-name" class="form-input" value="${escHtml(dept?.name || '')}" required placeholder="VD: Khoa Sản 3" />
          </div>
          <div class="form-group">
            <label class="form-label">Mô tả</label>
            <input type="text" id="df-desc" class="form-input" value="${escHtml(dept?.description || '')}" placeholder="Mô tả ngắn" />
          </div>
          <div class="form-group">
            <label class="form-label">Màu sắc</label>
            <input type="color" id="df-color" value="${escHtml(dept?.color || '#2D2B8C')}" />
          </div>
          <div class="form-group">
            <label class="form-label">Thứ tự hiển thị</label>
            <input type="number" id="df-order" class="form-input" value="${escHtml(String(dept?.sortOrder || 1))}" min="1" style="max-width:120px" />
          </div>
          <div class="form-group">
            <label class="form-label">Trạng thái</label>
            <select id="df-active" class="form-select">
              <option value="TRUE"  ${(dept?.active === true || String(dept?.active).toUpperCase() === 'TRUE') ? 'selected' : ''}>Hiển thị</option>
              <option value="FALSE" ${String(dept?.active).toUpperCase() === 'FALSE' ? 'selected' : ''}>Ẩn</option>
            </select>
          </div>
          <div class="admin-form-actions">
            <button type="submit" class="btn btn-primary btn-sm">Lưu</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="App.cancelEdit()">Huỷ</button>
          </div>
        </form>
      </div>
    `;
  },

  editDept(deptObj) {
    const dept = typeof deptObj === 'string' ? JSON.parse(deptObj) : deptObj;
    state.adminEditItem = dept;
    this.renderAdminTab();
  },

  async saveDeptForm(e, existingId) {
    e.preventDefault();
    const item = {
      id:          existingId || document.getElementById('df-id').value || genId(),
      name:        document.getElementById('df-name').value.trim(),
      description: document.getElementById('df-desc').value.trim(),
      color:       document.getElementById('df-color').value,
      sortOrder:   parseInt(document.getElementById('df-order').value) || 1,
      active:      document.getElementById('df-active').value
    };
    if (!item.name) { this.showToast('Vui lòng nhập tên khoa', 'error'); return; }

    this.showLoading('Đang lưu...');
    const res = await API.saveDept(item);
    this.hideLoading();

    if (res.success) {
      this.showToast('Lưu thành công!', 'success');
      Cache.clear();
      state.adminEditItem = 'none';
      state.adminDepts = null;
      this.renderAdminTab();
    } else {
      this.showToast('Lỗi: ' + (res.error || 'Không lưu được'), 'error');
    }
  },

  /* --- Admin: Quản lý Bệnh Lý --- */
  async buildAdminConditions() {
    // Cần danh sách khoa để chọn
    const deptRes = await API.getDepts();
    state.adminDepts = deptRes.data || [];

    let condRes = { data: [] };
    if (!state.adminFilterDept && state.adminDepts.length) {
      state.adminFilterDept = state.adminDepts[0].id;
    }
    if (state.adminFilterDept) {
      condRes = await API.getConditions(state.adminFilterDept);
    }
    state.adminConditions = condRes.data || [];

    const editing = state.adminEditItem;

    return `
      <div class="admin-filters">
        <select class="form-select" onchange="App.setAdminFilterDept(this.value)">
          ${state.adminDepts.map(d => `
            <option value="${escHtml(d.id)}" ${state.adminFilterDept === d.id ? 'selected' : ''}>${escHtml(d.name)}</option>
          `).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="App.editCondition(null)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Thêm mới
        </button>
      </div>

      ${editing !== undefined && editing !== 'none' ? this.renderConditionForm(editing) : ''}

      <div class="admin-list">
        ${!state.adminConditions.length ? `
          <div class="empty-state">
            <p>Chưa có bệnh lý nào cho khoa này.</p>
          </div>
        ` : state.adminConditions.map(c => `
          <div class="admin-list-item">
            <div class="admin-list-item-body">
              <div class="admin-list-item-title">${escHtml(c.name)}</div>
              <div class="admin-list-item-meta">
                ${escHtml(c.shortDesc || '')}
                &nbsp;·&nbsp;
                <span class="${severityClass(c.severity)}">${severityLabel(c.severity)}</span>
                &nbsp;·&nbsp;
                <span class="status-badge ${c.active === true || String(c.active).toUpperCase() === 'TRUE' ? 'status-active' : 'status-inactive'}">
                  ${c.active === true || String(c.active).toUpperCase() === 'TRUE' ? 'Hiển thị' : 'Ẩn'}
                </span>
              </div>
            </div>
            <div class="admin-list-item-actions">
              <button class="btn btn-ghost btn-sm btn-icon" onclick="App.editCondition(${escHtml(JSON.stringify(c))})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn-ghost btn-sm btn-icon" style="color:var(--danger)" onclick="App.confirmDelete('condition','${escHtml(c.id)}','${escHtml(c.name)}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  renderConditionForm(cond) {
    const isNew = !cond || !cond.id;
    const depts = state.adminDepts || [];
    return `
      <div class="admin-form-panel">
        <div class="admin-form-title">
          ${isNew ? 'Thêm Bệnh Lý mới' : 'Sửa: ' + escHtml(cond?.name)}
        </div>
        <form onsubmit="App.saveConditionForm(event)">
          <input type="hidden" id="cf-id"     value="${escHtml(cond?.id || '')}" />
          <div class="form-group">
            <label class="form-label">Khoa <span class="req">*</span></label>
            <select id="cf-dept" class="form-select" required>
              ${depts.map(d => `
                <option value="${escHtml(d.id)}" ${(cond?.deptId || state.adminFilterDept) === d.id ? 'selected' : ''}>${escHtml(d.name)}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Tên Bệnh Lý <span class="req">*</span></label>
            <input type="text" id="cf-name" class="form-input" value="${escHtml(cond?.name || '')}" required placeholder="VD: Dọa đẻ non" />
          </div>
          <div class="form-group">
            <label class="form-label">Mô tả ngắn</label>
            <input type="text" id="cf-desc" class="form-input" value="${escHtml(cond?.shortDesc || '')}" placeholder="Mô tả ngắn gọn" />
          </div>
          <div class="form-group">
            <label class="form-label">Mức độ</label>
            <select id="cf-severity" class="form-select">
              <option value="low"    ${cond?.severity === 'low'    ? 'selected' : ''}>Thấp</option>
              <option value="medium" ${cond?.severity === 'medium' ? 'selected' : ''}>Trung bình</option>
              <option value="high"   ${cond?.severity === 'high'   ? 'selected' : ''}>Cao</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Thứ tự</label>
            <input type="number" id="cf-order" class="form-input" value="${escHtml(String(cond?.sortOrder || 1))}" min="1" style="max-width:120px" />
          </div>
          <div class="form-group">
            <label class="form-label">Trạng thái</label>
            <select id="cf-active" class="form-select">
              <option value="TRUE"  ${!cond || cond?.active === true || String(cond?.active).toUpperCase() === 'TRUE' ? 'selected' : ''}>Hiển thị</option>
              <option value="FALSE" ${String(cond?.active).toUpperCase() === 'FALSE' ? 'selected' : ''}>Ẩn</option>
            </select>
          </div>
          <div class="admin-form-actions">
            <button type="submit" class="btn btn-primary btn-sm">Lưu</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="App.cancelEdit()">Huỷ</button>
          </div>
        </form>
      </div>
    `;
  },

  editCondition(condObj) {
    const cond = typeof condObj === 'string' ? JSON.parse(condObj) : condObj;
    state.adminEditItem = cond;
    this.renderAdminTab();
  },

  async saveConditionForm(e) {
    e.preventDefault();
    const item = {
      id:        document.getElementById('cf-id').value || genId(),
      deptId:    document.getElementById('cf-dept').value,
      name:      document.getElementById('cf-name').value.trim(),
      shortDesc: document.getElementById('cf-desc').value.trim(),
      severity:  document.getElementById('cf-severity').value,
      sortOrder: parseInt(document.getElementById('cf-order').value) || 1,
      active:    document.getElementById('cf-active').value
    };
    if (!item.name || !item.deptId) { this.showToast('Vui lòng điền đầy đủ thông tin', 'error'); return; }

    this.showLoading('Đang lưu...');
    const res = await API.saveCondition(item);
    this.hideLoading();

    if (res.success) {
      this.showToast('Lưu thành công!', 'success');
      Cache.clear();
      state.adminEditItem = 'none';
      state.adminConditions = null;
      this.renderAdminTab();
    } else {
      this.showToast('Lỗi: ' + (res.error || 'Không lưu được'), 'error');
    }
  },

  async setAdminFilterDept(deptId) {
    state.adminFilterDept = deptId;
    state.adminEditItem = 'none';
    this.renderAdminTab();
  },

  /* --- Admin: Quản lý Mẫu Phiếu --- */
  async buildAdminProtocols() {
    const deptRes = await API.getDepts();
    state.adminDepts = deptRes.data || [];

    if (!state.adminFilterDept && state.adminDepts.length) {
      state.adminFilterDept = state.adminDepts[0].id;
    }

    let condRes = { data: [] };
    if (state.adminFilterDept) {
      condRes = await API.getConditions(state.adminFilterDept);
    }
    state.adminConditions = condRes.data || [];

    if (!state.adminFilterCond && state.adminConditions.length) {
      state.adminFilterCond = state.adminConditions[0].id;
    }

    let proRes = { data: [] };
    if (state.adminFilterCond) {
      proRes = await API.getProtocol(state.adminFilterCond);
    }
    state.adminProtocols = proRes.data || [];

    const editing = state.adminEditItem;

    return `
      <div class="admin-filters">
        <select class="form-select" onchange="App.setAdminFilterDeptProto(this.value)">
          ${state.adminDepts.map(d => `
            <option value="${escHtml(d.id)}" ${state.adminFilterDept === d.id ? 'selected' : ''}>${escHtml(d.name)}</option>
          `).join('')}
        </select>
        <select class="form-select" onchange="App.setAdminFilterCond(this.value)">
          ${!state.adminConditions.length
            ? '<option value="">— Chưa có bệnh lý —</option>'
            : state.adminConditions.map(c => `
                <option value="${escHtml(c.id)}" ${state.adminFilterCond === c.id ? 'selected' : ''}>${escHtml(c.name)}</option>
              `).join('')}
        </select>
      </div>

      ${state.adminFilterCond ? `
        <div class="add-row">
          <button class="btn btn-primary btn-sm" onclick="App.editProtocol(null)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Thêm ngày / giai đoạn
          </button>
        </div>
      ` : ''}

      ${editing !== undefined && editing !== 'none' && state.adminFilterCond ? this.renderProtocolForm(editing) : ''}

      <div class="admin-list">
        ${!state.adminFilterCond ? '<div class="empty-state"><p>Chọn khoa và bệnh lý để xem mẫu phiếu.</p></div>'
          : !state.adminProtocols.length ? `
          <div class="empty-state">
            <p>Chưa có mẫu phiếu nào.</p>
          </div>`
          : state.adminProtocols.map((p, idx) => `
          <div class="admin-list-item" style="flex-direction:column;gap:8px">
            <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
              <div>
                <span class="day-badge">${escHtml(p.dayLabel || `Ngày ${idx+1}`)}</span>
                <div class="admin-list-item-meta">Chăm sóc: ${escHtml(p.careLevel || '—')}</div>
              </div>
              <div class="admin-list-item-actions">
                <button class="btn btn-ghost btn-sm btn-icon" onclick="App.editProtocol('${escHtml(p.id)}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn btn-ghost btn-sm btn-icon" style="color:var(--danger)" onclick="App.confirmDelete('protocol','${escHtml(p.id)}','${escHtml(p.dayLabel || '')}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  renderProtocolForm(proto) {
    const isNew = !proto || !proto.id;

    return `
      <div class="admin-form-panel">
        <div class="admin-form-title">
          ${isNew ? 'Thêm giai đoạn mới' : 'Sửa: ' + escHtml(proto?.dayLabel)}
        </div>
        <form onsubmit="App.saveProtocolForm(event)">
          <input type="hidden" id="pf-id"     value="${escHtml(proto?.id || '')}" />
          <input type="hidden" id="pf-condid" value="${escHtml(state.adminFilterCond)}" />
          
          <div class="form-group">
            <label class="form-label">Tên giai đoạn <span class="req">*</span></label>
            <input type="text" id="pf-day" class="form-input" value="${escHtml(proto?.dayLabel || '')}"
                   required placeholder="VD: Ngày 1, Ngày 2-3, Xuất viện..." />
          </div>

          <div class="form-group">
            <label class="form-label" style="font-weight: 700;">Các Phân Mục Chi Tiết</label>
            
            <div id="protocol-sections-container">
              <!-- Các phân mục động được chèn tại đây -->
            </div>

            <button type="button" class="btn btn-ghost btn-sm" onclick="App.addFormSection()" style="margin-top: 8px; border: 1px dashed var(--text-secondary); width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Thêm phân mục mới
            </button>
          </div>

          <div class="form-group">
            <label class="form-label">Cấp Độ Chăm Sóc</label>
            <input type="text" id="pf-care" class="form-input" value="${escHtml(proto?.careLevel || '')}" placeholder="VD: Cấp 1, Cấp 2, Cấp 3" />
          </div>

          <div class="form-group">
            <label class="form-label">Thứ tự</label>
            <input type="number" id="pf-order" class="form-input" value="${escHtml(String(proto?.sortOrder || (state.adminProtocols?.length + 1) || 1))}" min="1" style="max-width:120px" />
          </div>

          <div class="admin-form-actions">
            <button type="submit" class="btn btn-primary btn-sm">Lưu Mẫu Phiếu</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="App.cancelEdit()">Huỷ</button>
          </div>
        </form>
      </div>
    `;
  },

  async editProtocol(protoId) {
    let proto = null;
    if (protoId) {
      proto = (state.adminProtocols || []).find(p => p.id === protoId);
    }
    state.adminEditItem = proto || { id: '', dayLabel: '', careLevel: '', sortOrder: '' };
    await this.renderAdminTab();

    let sections;
    if (!protoId || !proto) {
      sections = [
        { title: 'Thăm Khám, Đánh Giá', content: '' },
        { title: 'Cận Lâm Sàng',           content: '' },
        { title: 'Điều Trị',                  content: '' },
        { title: 'Dinh Dưỡng & Sinh Hoạt',   content: '' },
        { title: 'Truyền Thông',              content: '' }
      ];
    } else {
      sections = parseProtocolSections(proto);
    }
    this.renderFormSections(sections);
  },

  renderFormSections(sections) {
    const container = document.getElementById('protocol-sections-container');
    if (!container) return;

    container.innerHTML = sections.map((sec, idx) => `
      <div class="form-section-item" data-index="${idx}" style="border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-md); margin-bottom: var(--space-md); background: #FAF9FF;">
        <div style="display: flex; gap: var(--space-sm); align-items: center; margin-bottom: var(--space-xs);">
          <input type="text" class="form-input section-title-input" value="${escHtml(sec.title)}" placeholder="Tên phân mục (VD: Thăm khám...)" style="font-weight: 600; flex: 1;" required />
          
          <div style="display: flex; gap: 4px; flex-shrink: 0;">
            <button type="button" class="btn btn-ghost btn-sm btn-icon" onclick="App.moveFormSection(${idx}, -1)" title="Di chuyển lên" ${idx === 0 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" onclick="App.moveFormSection(${idx}, 1)" title="Di chuyển xuống" ${idx === sections.length - 1 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" style="color: var(--danger);" onclick="App.deleteFormSection(${idx})" title="Xóa phân mục">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>
        <textarea class="form-textarea section-content-textarea" rows="3" placeholder="Nội dung (mỗi dòng là một đầu dòng)...">${escHtml(sec.content)}</textarea>
      </div>
    `).join('');
  },

  getFormSections() {
    const container = document.getElementById('protocol-sections-container');
    if (!container) return [];
    const items = container.querySelectorAll('.form-section-item');
    const sections = [];
    items.forEach(item => {
      const titleInput = item.querySelector('.section-title-input');
      const contentArea = item.querySelector('.section-content-textarea');
      if (titleInput) {
        sections.push({
          title: titleInput.value.trim(),
          content: contentArea ? contentArea.value.trim() : ''
        });
      }
    });
    return sections;
  },

  addFormSection() {
    const sections = this.getFormSections();
    sections.push({ title: '', content: '' });
    this.renderFormSections(sections);
  },

  deleteFormSection(index) {
    const sections = this.getFormSections();
    sections.splice(index, 1);
    this.renderFormSections(sections);
  },

  moveFormSection(index, direction) {
    const sections = this.getFormSections();
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sections.length) return;

    // Tráo đổi vị trí
    const temp = sections[index];
    sections[index] = sections[targetIndex];
    sections[targetIndex] = temp;

    this.renderFormSections(sections);
  },

  async saveProtocolForm(e) {
    e.preventDefault();
    
    const sections = this.getFormSections().filter(sec => sec.title.trim() !== '');

    const item = {
      id:            document.getElementById('pf-id').value || genId(),
      condId:        document.getElementById('pf-condid').value,
      dayLabel:      document.getElementById('pf-day').value.trim(),
      assessment:    JSON.stringify(sections),
      labTests:      '',
      treatment:     '',
      nutrition:     '',
      communication: '',
      careLevel:     document.getElementById('pf-care').value.trim(),
      sortOrder:     parseInt(document.getElementById('pf-order').value) || 1
    };
    if (!item.dayLabel || !item.condId) { this.showToast('Vui lòng nhập tên giai đoạn', 'error'); return; }

    this.showLoading('Đang lưu...');
    const res = await API.saveProtocol(item);
    this.hideLoading();

    if (res.success) {
      this.showToast('Lưu thành công!', 'success');
      Cache.clear();
      state.adminEditItem = 'none';
      state.adminProtocols = null;
      this.renderAdminTab();
    } else {
      this.showToast('Lỗi: ' + (res.error || 'Không lưu được'), 'error');
    }
  },

  async setAdminFilterDeptProto(deptId) {
    state.adminFilterDept = deptId;
    state.adminFilterCond = '';
    state.adminEditItem = 'none';
    this.renderAdminTab();
  },

  async setAdminFilterCond(condId) {
    state.adminFilterCond = condId;
    state.adminEditItem = 'none';
    this.renderAdminTab();
  },

  /* --- Admin: Cài Đặt --- */
  buildAdminSettings() {
    return `
      <div style="max-width:400px">
        <h2 class="admin-form-title" style="font-size:var(--font-size-md);margin-bottom:var(--space-xl)">Đổi Mật Khẩu Admin</h2>
        <form onsubmit="App.doChangePassword(event)">
          <div class="form-group">
            <label class="form-label">Mật khẩu hiện tại <span class="req">*</span></label>
            <input type="password" id="cp-old" class="form-input" placeholder="Mật khẩu cũ..." required />
          </div>
          <div class="form-group">
            <label class="form-label">Mật khẩu mới <span class="req">*</span></label>
            <input type="password" id="cp-new" class="form-input" placeholder="Mật khẩu mới (tối thiểu 6 ký tự)..." required minlength="6" />
          </div>
          <div class="form-group">
            <label class="form-label">Xác nhận mật khẩu mới <span class="req">*</span></label>
            <input type="password" id="cp-confirm" class="form-input" placeholder="Nhập lại mật khẩu mới..." required />
          </div>
          <div id="cp-err" class="hidden" style="color:var(--danger);font-size:var(--font-size-sm);margin-bottom:var(--space-base)"></div>
          <button type="submit" class="btn btn-primary">Đổi Mật Khẩu</button>
        </form>

        <div class="section-divider"></div>

        <h2 class="admin-form-title" style="font-size:var(--font-size-md);margin-bottom:var(--space-base)">Thông Tin Hệ Thống</h2>
        <div class="text-muted">
          <p>Phiên bản: ${CONFIG.VERSION}</p>
          <p class="mt-sm">URL Apps Script: <code style="font-size:11px;word-break:break-all">${CONFIG.SCRIPT_URL.substring(0,40)}...</code></p>
        </div>


      </div>
    `;
  },

  async doChangePassword(e) {
    e.preventDefault();
    const old    = document.getElementById('cp-old').value;
    const newPw  = document.getElementById('cp-new').value;
    const conf   = document.getElementById('cp-confirm').value;
    const errEl  = document.getElementById('cp-err');

    if (newPw !== conf) {
      errEl.textContent = 'Mật khẩu xác nhận không khớp';
      errEl.classList.remove('hidden');
      return;
    }

    // Verify current password first
    this.showLoading('Đang xác thực...');
    const loginRes = await API.login(old);
    if (!loginRes.success) {
      this.hideLoading();
      errEl.textContent = 'Mật khẩu hiện tại không đúng';
      errEl.classList.remove('hidden');
      return;
    }

    const res = await API.changePassword(newPw);
    this.hideLoading();

    if (res.success) {
      this.showToast('Đổi mật khẩu thành công!', 'success');
      errEl.classList.add('hidden');
      document.getElementById('cp-old').value = '';
      document.getElementById('cp-new').value = '';
      document.getElementById('cp-confirm').value = '';
    } else {
      errEl.textContent = 'Lỗi: ' + (res.error || 'Không đổi được');
      errEl.classList.remove('hidden');
    }
  },

  cancelEdit() {
    state.adminEditItem = 'none';
    this.renderAdminTab();
  },

  async doLogout() {
    this.showLoading('Đang đăng xuất...');
    await API.logout();
    this.hideLoading();
    state.adminToken = null;
    sessionStorage.removeItem(CONFIG.ADMIN_TOKEN_KEY);
    this.showToast('Đã đăng xuất', 'success');
    this.navigate('home');
  },



  /* ================================================================
     CONFIRM DELETE
     ================================================================ */
  confirmDelete(type, id, name) {
    const titles = { dept: 'Xoá Khoa', condition: 'Xoá Bệnh Lý', protocol: 'Xoá Giai Đoạn' };
    document.getElementById('modal-title').textContent = titles[type] || 'Xoá';
    document.getElementById('modal-msg').textContent   = `Bạn có chắc muốn xoá "${name}"? Hành động này không thể hoàn tác.`;

    state.modalCallback = async () => {
      this.closeModal();
      this.showLoading('Đang xoá...');
      let res;
      if (type === 'dept')      res = await API.deleteDept(id);
      if (type === 'condition') res = await API.deleteCondition(id);
      if (type === 'protocol')  res = await API.deleteProtocol(id);
      this.hideLoading();
      if (res?.success) {
        this.showToast('Đã xoá thành công!', 'success');
        Cache.clear();
        state.adminEditItem = 'none';
        this.renderAdminTab();
      } else {
        this.showToast('Lỗi khi xoá: ' + (res?.error || ''), 'error');
      }
    };

    document.getElementById('modal-confirm').onclick = () => state.modalCallback?.();
    document.getElementById('modal-overlay').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    state.modalCallback = null;
  },

  /* ================================================================
     UI HELPERS
     ================================================================ */
  renderLoading(inline) {
    if (inline) return '<div class="spinner" style="width:24px;height:24px;border-width:2.5px"></div>';
    return `<div class="loading-screen"><div class="spinner"></div><p>Đang tải...</p></div>`;
  },

  renderError(msg) {
    return `
      <div class="empty-state" style="grid-column:1/-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>${escHtml(msg)}</p>
        <button class="btn btn-ghost btn-sm" onclick="App.afterRender()">Thử lại</button>
      </div>`;
  },

  showToast(msg, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    el.textContent = msg;
    el.className = `toast ${type}`;
    state.toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 3000);
  },

  showLoading(msg = 'Đang xử lý...') {
    document.getElementById('loading-msg').textContent = msg;
    document.getElementById('loading-overlay').classList.remove('hidden');
  },

  hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
  },



  initCustomSelects() {
    const selects = document.querySelectorAll('select.form-select');
    selects.forEach(select => {
      if (select.dataset.customInitialized) return;
      select.dataset.customInitialized = 'true';

      const wrapper = document.createElement('div');
      wrapper.className = 'custom-select-wrapper';
      select.parentNode.insertBefore(wrapper, select);
      wrapper.appendChild(select);

      const trigger = document.createElement('div');
      trigger.className = 'custom-select-trigger';
      
      const triggerText = document.createElement('span');
      triggerText.className = 'custom-select-text';
      triggerText.textContent = select.options[select.selectedIndex]?.text || '';
      trigger.appendChild(triggerText);

      const arrow = document.createElement('div');
      arrow.className = 'custom-select-arrow';
      arrow.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
      trigger.appendChild(arrow);

      wrapper.appendChild(trigger);

      const optionsContainer = document.createElement('div');
      optionsContainer.className = 'custom-select-options hidden';

      const updateOptions = () => {
        optionsContainer.innerHTML = '';
        Array.from(select.options).forEach((opt) => {
          const customOpt = document.createElement('div');
          customOpt.className = 'custom-select-option';
          if (opt.selected) customOpt.classList.add('selected');
          customOpt.textContent = opt.text;
          customOpt.dataset.value = opt.value;
          customOpt.addEventListener('click', (e) => {
            e.stopPropagation();
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            triggerText.textContent = opt.text;
            optionsContainer.classList.add('hidden');
            wrapper.classList.remove('open');
          });
          optionsContainer.appendChild(customOpt);
        });
      };

      updateOptions();
      wrapper.appendChild(optionsContainer);

      select.style.position = 'absolute';
      select.style.opacity = '0';
      select.style.width = '0';
      select.style.height = '0';
      select.style.pointerEvents = 'none';

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        
        document.querySelectorAll('.custom-select-wrapper.open').forEach(other => {
          if (other !== wrapper) {
            other.classList.remove('open');
            other.querySelector('.custom-select-options').classList.add('hidden');
          }
        });

        const isOpen = !optionsContainer.classList.contains('hidden');
        optionsContainer.classList.toggle('hidden', isOpen);
        wrapper.classList.toggle('open', !isOpen);
      });

      const observer = new MutationObserver(() => {
        updateOptions();
        triggerText.textContent = select.options[select.selectedIndex]?.text || '';
      });
      observer.observe(select, { childList: true, subtree: true });

      select.addEventListener('change', () => {
        triggerText.textContent = select.options[select.selectedIndex]?.text || '';
        optionsContainer.querySelectorAll('.custom-select-option').forEach(optEl => {
          optEl.classList.toggle('selected', optEl.dataset.value === select.value);
        });
      });
    });

    if (!window.customSelectGlobalListenerAdded) {
      window.customSelectGlobalListenerAdded = true;
      document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select-wrapper.open').forEach(wrapper => {
          wrapper.classList.remove('open');
          wrapper.querySelector('.custom-select-options').classList.add('hidden');
        });
      });
    }
  }
};

/* ================================================================
   PROTOCOL ICONS (Inline SVG)
   ================================================================ */
function iconStethoscope() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4.8 2.3A.3.3 0 105 2H4a2 2 0 00-2 2v5a6 6 0 006 6v0a6 6 0 006-6V4a2 2 0 00-2-2h-1a.2.2 0 10.3.3"/><line x1="8" y1="15" x2="8" y2="18"/><circle cx="16" cy="18" r="3"/><line x1="8" y1="18" x2="13" y2="18"/></svg>`;
}
function iconLab() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/></svg>`;
}
function iconPill() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.5 20H4a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2v7.5"/><polyline points="8 11 12 15 16 11"/><line x1="12" y1="4" x2="12" y2="15"/><circle cx="18" cy="20" r="3"/><path d="m15.7 17.7 4.6 4.6"/></svg>`;
}
function iconNutrition() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a7 7 0 017 7c0 4-7 13-7 13S5 13 5 9a7 7 0 017-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
}
function iconComm() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
}
function iconCare() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
}

/* ================================================================
   INIT
   ================================================================ */
window.addEventListener('DOMContentLoaded', () => App.init());
