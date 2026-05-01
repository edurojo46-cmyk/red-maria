var app = {
    currentScreen: 'screen-splash',
    screens: ['screen-splash','screen-register','screen-login','screen-forgot-password','screen-reset-password','screen-map','screen-intenciones','screen-create-rosary','screen-rosary-detail','screen-rezo','screen-event','screen-live','screen-como-rezar','screen-profile','screen-porque-rezar','screen-chat','screen-apariciones','screen-cenaculo','screen-iglesias'],
    pickerMap: null, pickerMarker: null, pickerLocation: null,
    detailMap: null,
    buscarMap: null,
    ROSARY_STORAGE_KEY: 'redmaria_rosaries',
    JOINED_ROSARIES_KEY: 'redmaria_joined',
    CONTINUO_KEY: 'redmaria_continuo',
    continuoDate: new Date(),
    // Helper: get YYYY-MM-DD from a Date in LOCAL timezone (not UTC)
    localDateKey: function(d) {
        var y = d.getFullYear();
        var m = (d.getMonth() + 1).toString().padStart(2, '0');
        var day = d.getDate().toString().padStart(2, '0');
        return y + '-' + m + '-' + day;
    },
    recoveryEmail: null,
    recoveryCode: null,

    init() {
        this.generateSplashBeads();
        // Clear stale continuo data on load - Supabase is the source of truth
        try { localStorage.removeItem(this.CONTINUO_KEY); } catch(e) {}
        this.renderContinuo().catch(function(e) { console.warn('[Init] Continuo render failed:', e); });
        this.generateParticipants();
        this.loadRosaryCards();
        authUI.init();
        this.setupCreateRosaryForm();
        this.setupForgotPasswordForm();
        this.setupResetPasswordForm();
        this.setupResetStrengthMeter();
        if (auth.isAuthenticated()) this.updateUserUI();

        this.updateNavVisibility(this.currentScreen);
        document.querySelectorAll('.header-nav a').forEach(a => a.addEventListener('click', e => e.preventDefault()));
    },

    async loadRosaryCards() {
        const list = document.getElementById('rosary-list'); if (!list) return;
        // Load from Supabase first, fallback to localStorage
        var rosaries = this.getActiveRosaries();
        if (typeof db !== 'undefined' && db.getRosaries) {
            try {
                var remote = await db.getRosaries();
                if (remote && remote.length > 0) {
                    // Map Supabase fields to local format
                    rosaries = remote.map(function(r) {
                        return {
                            id: r.id, place: r.place, address: r.address || '', date: r.date, time: r.time,
                            mystery: r.mystery, intention: r.intention, lat: r.lat, lng: r.lng,
                            participants: r.participants || 1, creatorId: r.creator_id,
                            creatorName: r.creator_name || 'Anónimo'
                        };
                    });
                    // Save to localStorage for offline
                    localStorage.setItem('redmaria_rosaries', JSON.stringify(rosaries));
                    console.log('[Rosaries] Loaded', rosaries.length, 'from Supabase');
                }
            } catch(e) {
                console.warn('[Rosaries] Supabase failed, using local:', e.message);
            }
        }
        // Filter active
        rosaries = rosaries.filter(r => !this.isRosaryExpired(r));
        rosaries.forEach(r => this.addRosaryCard(r));
        // Update stats
        var countEl = document.getElementById('buscar-cards-count');
        var emptyEl = document.getElementById('buscar-empty');
        var statRos = document.getElementById('buscar-stat-rosaries');
        if (countEl) countEl.textContent = rosaries.length + ' encontrados';
        if (emptyEl) emptyEl.style.display = rosaries.length === 0 ? '' : 'none';
        if (statRos) statRos.textContent = rosaries.length;
    },

    initPickerMap() {
        if (this.pickerMap) { this.pickerMap.invalidateSize(); return; }
        this.pickerMap = L.map('picker-map', { zoomControl: false, attributionControl: false }).setView([-34.5955,-58.3739], 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(this.pickerMap);
        L.control.zoom({ position: 'topright' }).addTo(this.pickerMap);
        this.pickerMap.on('click', e => this.setPickerLocation(e.latlng.lat, e.latlng.lng));
    },

    async initBuscarMap() {
        if (!this.buscarMap) {
            this.buscarMap = L.map('buscar-map', { zoomControl: false, attributionControl: false }).setView([-34.5955, -58.3739], 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(this.buscarMap);
            L.control.zoom({ position: 'topright' }).addTo(this.buscarMap);
            this._buscarMarkers = [];
        } else {
            this.buscarMap.invalidateSize();
        }
        // Always reload rosaries
        await this._loadBuscarRosaries();
    },

    async _loadBuscarRosaries() {
        // Clear old markers
        if (this._buscarMarkers) {
            this._buscarMarkers.forEach(m => this.buscarMap.removeLayer(m));
            this._buscarMarkers = [];
        }

        // Load from Supabase first
        var activeRosaries = [];
        if (typeof db !== 'undefined' && db.getRosaries) {
            try {
                var remote = await db.getRosaries();
                if (remote && remote.length > 0) {
                    activeRosaries = remote.map(function(r) {
                        return {
                            id: r.id, place: r.place, address: r.address || '', date: r.date, time: r.time,
                            mystery: r.mystery, intention: r.intention, lat: r.lat, lng: r.lng,
                            participants: r.participants || 1, creatorId: r.creator_id,
                            creatorName: r.creator_name || 'Anónimo'
                        };
                    });
                    localStorage.setItem('redmaria_rosaries', JSON.stringify(activeRosaries));
                    console.log('[Map] Loaded', activeRosaries.length, 'rosaries from Supabase');
                }
            } catch(e) { console.warn('[Map] Supabase failed:', e.message); }
        }

        // Fallback to localStorage
        if (activeRosaries.length === 0) {
            activeRosaries = this.getActiveRosaries();
            console.log('[Map] Using', activeRosaries.length, 'rosaries from localStorage');
        }

        // Add markers
        let totalPeople = 0;
        activeRosaries.forEach(r => {
            if (r.lat && r.lng) {
                const pCount = r.participants || 1;
                totalPeople += pCount;
                const icon = L.divIcon({ className: 'custom-marker-wrapper', html: '<div class="custom-map-marker user-marker"><i class="ri-map-pin-fill" style="font-size:1rem;color:white"></i><span class="marker-count">' + pCount + '</span></div>', iconSize: [36, 44], iconAnchor: [18, 44] });
                const marker = L.marker([r.lat, r.lng], { icon }).addTo(this.buscarMap);
                marker.bindPopup(() => this._buildMapPopup(r.id, r.place, r.time, r.mystery, r.intention, r.participants || 1), { className: 'rosary-map-popup', maxWidth: 260 });
                this._buscarMarkers.push(marker);
            }
        });

        // Update stats
        const statRos = document.getElementById('buscar-stat-rosaries');
        const statPpl = document.getElementById('buscar-stat-people');
        const countEl = document.getElementById('buscar-cards-count');
        const emptyEl = document.getElementById('buscar-empty');
        if (statRos) statRos.textContent = activeRosaries.length;
        if (statPpl) statPpl.textContent = totalPeople;
        if (countEl) countEl.textContent = activeRosaries.length + ' encontrados';
        if (emptyEl) emptyEl.style.display = activeRosaries.length === 0 ? '' : 'none';

        // Render cards
        const list = document.getElementById('rosary-list');
        if (list) list.innerHTML = '';
        activeRosaries.forEach(r => this.addRosaryCard(r));
    },

    _buildMapPopup(id, name, time, mystery, intention, participants) {
        const joined = this.getJoinedRosaries();
        const isJoined = joined.some(j => j.id === id);
        const btnClass = isJoined ? 'popup-btn-leave' : 'popup-btn-join';
        const btnText = isJoined ? '<i class="ri-close-circle-line"></i> Salir' : '<i class="ri-add-circle-line"></i> Unirme';
        const btnAction = isJoined
            ? 'app.leaveRosary(\'' + id + '\')'
            : 'app.joinRosary(\'' + id + '\',\'' + name.replace(/'/g, "\\'") + '\',\'' + time + '\',\'' + mystery + '\',\'' + intention.replace(/'/g, "\\'") + '\',' + participants + ')';
        return '<div class="map-popup-content">' +
            '<h4 class="map-popup-name">' + name + '</h4>' +
            '<div class="map-popup-detail"><i class="ri-time-line"></i> Hoy ' + time + ' hs</div>' +
            '<div class="map-popup-detail"><i class="ri-sparkling-line"></i> Misterios ' + mystery + '</div>' +
            '<div class="map-popup-detail"><i class="ri-candle-line"></i> ' + intention + '</div>' +
            '<div class="map-popup-detail"><i class="ri-group-line"></i> ' + participants + ' participantes</div>' +
            '<button class="map-popup-btn ' + btnClass + '" onclick="' + btnAction + '">' + btnText + '</button>' +
            '</div>';
    },

    getJoinedRosaries() {
        try { return JSON.parse(localStorage.getItem(this.JOINED_ROSARIES_KEY)) || []; } catch { return []; }
    },

    joinRosary(id, name, time, mystery, intention, participants, date) {
        if (!auth.isAuthenticated()) { this.navigate('screen-login'); return; }
        const joined = this.getJoinedRosaries();
        if (joined.some(j => j.id === id)) return;
        // Get date from current rosary data if not passed as argument
        var rosaryDate = date || '';
        if (!rosaryDate && this._currentRosary) rosaryDate = this._currentRosary.date || '';
        joined.push({ id, name, time, mystery, intention, participants, date: rosaryDate, joinedAt: new Date().toISOString() });
        localStorage.setItem(this.JOINED_ROSARIES_KEY, JSON.stringify(joined));
        // Sync with Supabase
        if (typeof db !== 'undefined' && db.joinRosary) {
            const user = auth.getCurrentUser();
            if (user) db.joinRosary(id, user.id).catch(e => console.error('Join sync error:', e));
        }
        // Close and reopen popup to refresh button
        if (this.buscarMap) this.buscarMap.closePopup();
        this.renderProfileJoined();
        this.renderProfileMyRosaries();
    },

    leaveRosary(id) {
        let joined = this.getJoinedRosaries();
        joined = joined.filter(j => j.id !== id);
        localStorage.setItem(this.JOINED_ROSARIES_KEY, JSON.stringify(joined));
        // Sync with Supabase
        if (typeof db !== 'undefined' && db.leaveRosary) {
            const user = auth.getCurrentUser();
            if (user) db.leaveRosary(id, user.id).catch(e => console.error('Leave sync error:', e));
        }
        if (this.buscarMap) this.buscarMap.closePopup();
        this.renderProfileJoined();
        this.renderProfileMyRosaries();
    },

    cancelRosary(id, placeName) {
        // Show confirmation modal
        var modal = document.createElement('div');
        modal.className = 'slot-signup-modal';
        modal.innerHTML = '<div class="slot-signup-card">' +
            '<h3><i class="ri-error-warning-fill" style="color:#e74c3c"></i> Cancelar Rosario</h3>' +
            '<p style="font-size:0.9rem;color:#5A7D9A;margin:12px 0">¿Estás seguro de cancelar el rosario <strong>' + (placeName || '') + '</strong>?</p>' +
            '<p style="font-size:0.8rem;color:#e74c3c;margin-bottom:16px">Esta acción no se puede deshacer. Se eliminará para todos los participantes.</p>' +
            '<div class="slot-signup-actions">' +
                '<button class="btn btn-secondary-outline" id="cancel-rosary-no">Volver</button>' +
                '<button class="btn btn-primary" id="cancel-rosary-yes" style="background:linear-gradient(135deg,#e74c3c,#c0392b)"><i class="ri-delete-bin-line"></i> Sí, Cancelar</button>' +
            '</div>' +
        '</div>';
        document.body.appendChild(modal);
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        modal.querySelector('#cancel-rosary-no').onclick = function() { modal.remove(); };
        var self = this;
        modal.querySelector('#cancel-rosary-yes').onclick = function() {
            // Remove from local storage
            var rosaries = self.getRosaries().filter(function(r) { return r.id !== id; });
            localStorage.setItem(self.ROSARY_STORAGE_KEY, JSON.stringify(rosaries));
            // Also remove from joined
            var joined = self.getJoinedRosaries().filter(function(j) { return j.id !== id; });
            localStorage.setItem(self.JOINED_ROSARIES_KEY, JSON.stringify(joined));
            // Sync delete to Supabase
            if (typeof db !== 'undefined' && db.deleteRosary) {
                db.deleteRosary(id).catch(function(e) { console.error('Delete sync error:', e); });
            }
            modal.remove();
            self.renderProfileMyRosaries();
            self.renderProfileJoined();
        };
    },

    confirmLeaveRosary(id, placeName) {
        var modal = document.createElement('div');
        modal.className = 'slot-signup-modal';
        modal.innerHTML = '<div class="slot-signup-card">' +
            '<h3><i class="ri-logout-circle-r-line" style="color:#f0a500"></i> Desunirme</h3>' +
            '<p style="font-size:0.9rem;color:#5A7D9A;margin:12px 0">¿Deseas salir del rosario <strong>' + (placeName || '') + '</strong>?</p>' +
            '<div class="slot-signup-actions">' +
                '<button class="btn btn-secondary-outline" id="leave-rosary-no">Volver</button>' +
                '<button class="btn btn-primary" id="leave-rosary-yes" style="background:linear-gradient(135deg,#f0a500,#e09600)"><i class="ri-logout-circle-r-line"></i> Sí, Salir</button>' +
            '</div>' +
        '</div>';
        document.body.appendChild(modal);
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        modal.querySelector('#leave-rosary-no').onclick = function() { modal.remove(); };
        var self = this;
        modal.querySelector('#leave-rosary-yes').onclick = function() {
            self.leaveRosary(id);
            modal.remove();
        };
    },

    // Buscar page: filter cards by search text
    filterBuscarCards(query) {
        const cards = document.querySelectorAll('#rosary-list .rosary-card');
        const q = query.toLowerCase().trim();
        let visible = 0;
        cards.forEach(card => {
            const text = card.textContent.toLowerCase();
            const show = !q || text.includes(q);
            card.style.display = show ? '' : 'none';
            if (show) visible++;
        });
        const countEl = document.getElementById('buscar-cards-count');
        if (countEl) countEl.textContent = visible + ' encontrados';
        const emptyEl = document.getElementById('buscar-empty');
        if (emptyEl) emptyEl.style.display = visible === 0 ? '' : 'none';
    },

    // Buscar page: filter by time chip
    filterByTime(btn, period) {
        document.querySelectorAll('.buscar-chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        // For now just show all - future: integrate with date filtering
        this.filterBuscarCards(document.getElementById('buscar-search-input')?.value || '');
    },

    async renderProfileMyRosaries() {
        const container = document.getElementById('profile-my-rosaries'); if (!container) return;
        const user = auth.getCurrentUser(); if (!user) return;

        // Load local rosaries first
        let localRosaries = this.getActiveRosaries();
        let allRosaries = localRosaries.slice(); // copy

        // Merge Supabase rosaries (don't replace local ones)
        if (typeof db !== 'undefined' && db.getRosaries) {
            try {
                var remote = await db.getRosaries();
                if (remote && remote.length > 0) {
                    var localIds = {};
                    localRosaries.forEach(function(r) { localIds[r.id] = true; if (r.supabaseId) localIds[r.supabaseId] = true; });
                    remote.forEach(function(r) {
                        if (!localIds[r.id]) {
                            allRosaries.push({
                                id: r.id, place: r.place, address: r.address || '', date: r.date, time: r.time,
                                mystery: r.mystery, intention: r.intention, lat: r.lat, lng: r.lng,
                                participants: r.participants || 1, creatorId: r.creator_id,
                                creatorName: r.creator_name || 'Anónimo'
                            });
                        }
                    });
                }
            } catch(e) { console.warn('[Profile] Supabase rosaries failed:', e.message); }
        }

        // Get Supabase user UUID for matching (local auth ID is different)
        var supabaseUserId = null;
        var sbSession = localStorage.getItem('sb-spplofkotgvumfkeltsr-auth-token');
        if (sbSession) { try { var p = JSON.parse(sbSession); supabaseUserId = p.user ? p.user.id : null; } catch(e) {} }
        var userName = user.name ? user.name.toLowerCase().trim() : '';

        const myRosaries = allRosaries.filter(function(r) {
            // Match by creator_id (UUID or local)
            if (r.creatorId) {
                if (supabaseUserId && r.creatorId === supabaseUserId) return true;
                if (r.creatorId === user.id) return true;
            }
            // Fallback: ALWAYS check by creator_name (works for local auth without Supabase UUID)
            if (r.creatorName && userName && r.creatorName.toLowerCase().trim() === userName) return true;
            return false;
        });

        if (myRosaries.length === 0) {
            container.innerHTML = '<div class="profile-no-slots glass card"><i class="ri-add-circle-line"></i><p>Aún no creaste ningún rosario</p><button class="btn btn-primary" onclick="app.navigate(\'screen-create-rosary\')"><i class="ri-add-line"></i> Crear Rosario</button></div>';
            return;
        }
        let html = '';
        myRosaries.forEach(r => {
            const ds = this.formatDate(r.date);
            const confirmCount = r.participants || 1;
            var safePlaceName = (r.place||'').replace(/'/g, "\\'");
            html += '<div class="profile-rosary-card glass card">' +
                '<div class="profile-rosary-header">' +
                    '<div class="profile-rosary-icon coord-icon"><i class="ri-shield-star-fill"></i></div>' +
                    '<div class="profile-rosary-info">' +
                        '<h4>' + r.place + '</h4>' +
                        '<p><i class="ri-time-line"></i> ' + ds + ' ' + r.time + ' hs · Misterios ' + r.mystery + '</p>' +
                        '<span class="profile-rosary-intention"><i class="ri-candle-fill"></i> ' + r.intention + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="profile-rosary-footer">' +
                    '<div class="profile-rosary-stats">' +
                        '<span class="profile-rosary-badge coord-badge"><i class="ri-shield-star-fill"></i> Coordinador</span>' +
                        '<span class="profile-rosary-confirmed"><i class="ri-check-double-fill"></i> ' + confirmCount + ' confirmados</span>' +
                    '</div>' +
                    '<div class="profile-rosary-actions">' +
                        '<button class="btn btn-primary profile-rosary-btn" onclick="app._currentRosary = {id:\'' + r.id + '\',place:\'' + safePlaceName + '\',date:\'' + (r.date||'') + '\',time:\'' + (r.time||'') + '\',mystery:\'' + (r.mystery||'') + '\',intention:\'' + (r.intention||'').replace(/'/g, "\\'") + '\',creatorId:\'' + (r.creatorId||'') + '\',creatorName:\'' + (r.creatorName||'').replace(/'/g, "\\'") + '\',participants:' + (r.participants||1) + '}; app.navigate(\'screen-rezo\')"><i class="ri-play-circle-fill"></i> Rezar</button>' +
                        '<button class="btn profile-rosary-cancel-btn" onclick="app.cancelRosary(\'' + r.id + '\',\'' + safePlaceName + '\')" title="Cancelar rosario"><i class="ri-delete-bin-line"></i> Cancelar</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        });
        container.innerHTML = html;
    },

    async renderProfileJoined() {
        const container = document.getElementById('profile-joined-rosaries'); if (!container) return;
        const user = auth.getCurrentUser();
        var joined = this.getActiveJoinedRosaries();

        // Load full rosary data from Supabase to get creatorName and enrich joined data
        var fullRosaries = {};
        if (typeof db !== 'undefined' && db.getRosaries) {
            try {
                var remote = await db.getRosaries();
                if (remote) remote.forEach(function(r) {
                    fullRosaries[r.id] = { creatorId: r.creator_id, creatorName: r.creator_name || 'Anónimo', place: r.place, date: r.date, time: r.time, mystery: r.mystery, intention: r.intention, participants: r.participants || 1 };
                });
            } catch(e) {}
        }
        // Also check local rosaries
        this.getActiveRosaries().forEach(function(r) {
            if (!fullRosaries[r.id]) fullRosaries[r.id] = { creatorId: r.creatorId, creatorName: r.creatorName || 'Anónimo', place: r.place, date: r.date, time: r.time, mystery: r.mystery, intention: r.intention, participants: r.participants || 1 };
        });

        // Enrich joined rosaries with full data (fill missing fields)
        joined = joined.map(function(r) {
            var full = fullRosaries[r.id];
            if (full) {
                return {
                    id: r.id,
                    name: r.name || full.place || 'Rosario',
                    time: r.time || full.time || '',
                    mystery: r.mystery || full.mystery || '',
                    intention: r.intention || full.intention || '',
                    participants: full.participants || r.participants || 1,
                    date: r.date || full.date || '',
                    joinedAt: r.joinedAt
                };
            }
            return r;
        });

        // Filter out rosaries that user created (those go in 'Mis Rosarios')
        var supabaseUserId = null;
        var sbSession = localStorage.getItem('sb-spplofkotgvumfkeltsr-auth-token');
        if (sbSession) { try { var p = JSON.parse(sbSession); supabaseUserId = p.user ? p.user.id : null; } catch(e) {} }
        var userName = user ? (user.name || '').toLowerCase().trim() : '';
        const joinedOnly = joined.filter(function(r) {
            var full = fullRosaries[r.id];
            if (!full) return true;
            // Exclude if user is the creator
            if (full.creatorId && supabaseUserId && full.creatorId === supabaseUserId) return false;
            if (full.creatorId && user && full.creatorId === user.id) return false;
            if (full.creatorName && userName && full.creatorName.toLowerCase().trim() === userName) return false;
            return true;
        });

        if (joinedOnly.length === 0) {
            container.innerHTML = '<div class="profile-no-slots glass card"><i class="ri-map-pin-line"></i><p>Aún no te uniste a ningún rosario</p><button class="btn btn-primary" onclick="app.navigate(\'screen-map\')"><i class="ri-search-line"></i> Buscar Rosario</button></div>';
            return;
        }
        let html = '';
        joinedOnly.forEach(r => {
            var full = fullRosaries[r.id] || {};
            var coordName = full.creatorName || 'Anónimo';
            var coordId = full.creatorId || '';
            html += '<div class="profile-rosary-card glass card">' +
                '<div class="profile-rosary-header">' +
                    '<div class="profile-rosary-icon joined-icon"><i class="ri-map-pin-fill"></i></div>' +
                    '<div class="profile-rosary-info">' +
                        '<h4>' + r.name + '</h4>' +
                        '<p><i class="ri-time-line"></i> Hoy ' + r.time + ' hs · Misterios ' + (r.mystery || '') + '</p>' +
                        '<span class="profile-rosary-intention"><i class="ri-candle-fill"></i> ' + r.intention + '</span>' +
                        '<span style="font-size:0.7rem;color:var(--clr-text-muted)"><i class="ri-shield-star-line"></i> Coordina: ' + coordName + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="profile-rosary-footer">' +
                    '<div class="profile-rosary-stats">' +
                        '<span class="profile-rosary-badge joined-badge"><i class="ri-check-line"></i> Unido</span>' +
                    '</div>' +
                    '<div class="profile-rosary-actions">' +
                        '<button class="btn btn-primary profile-rosary-btn" onclick="app._currentRosary = {id:\'' + r.id + '\',place:\'' + (r.name || '').replace(/'/g, "\\'") + '\',time:\'' + r.time + '\',mystery:\'' + (r.mystery || '') + '\',intention:\'' + (r.intention || '').replace(/'/g, "\\'") + '\',creatorId:\'' + coordId + '\',creatorName:\'' + coordName.replace(/'/g, "\\'") + '\'}; app.navigate(\'screen-rezo\')"><i class="ri-play-circle-fill"></i> Rezar</button>' +
                        '<button class="btn profile-rosary-leave-btn" onclick="app.confirmLeaveRosary(\'' + r.id + '\',\'' + (r.name || '').replace(/'/g, "\\'") + '\')" title="Desunirme"><i class="ri-logout-circle-r-line"></i> Salir</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        });
        container.innerHTML = html;
    },

    setPickerLocation(lat, lng) {
        if (this.pickerMarker) this.pickerMap.removeLayer(this.pickerMarker);
        const icon = L.divIcon({ className: 'custom-marker-wrapper', html: '<div class="custom-map-marker picker-pin"><i class="ri-map-pin-add-fill" style="font-size:1.2rem"></i></div>', iconSize: [48,56], iconAnchor: [24,56] });
        this.pickerMarker = L.marker([lat, lng], { icon }).addTo(this.pickerMap);
        this.pickerLocation = { lat, lng };
        const ov = document.getElementById('picker-overlay'); if (ov) ov.style.display = 'none';
        const co = document.getElementById('picker-coords'); if (co) { co.innerHTML = '<i class="ri-map-pin-fill"></i> ' + lat.toFixed(4) + ', ' + lng.toFixed(4); co.classList.add('visible'); }
        const er = document.getElementById('rosary-location-error'); if (er) er.textContent = '';
    },

    getRosaries() { try { return JSON.parse(localStorage.getItem(this.ROSARY_STORAGE_KEY)) || []; } catch { return []; } },

    // Check if a rosary's date+time has already passed
    isRosaryExpired(rosary) {
        if (!rosary.date) return false;
        const now = new Date();
        const rosaryDate = new Date(rosary.date + 'T' + (rosary.time || '23:59'));
        // Add 2 hours grace period after scheduled time
        rosaryDate.setHours(rosaryDate.getHours() + 2);
        return now > rosaryDate;
    },

    // Get only rosaries whose date hasn't passed yet
    getActiveRosaries() {
        return this.getRosaries().filter(r => !this.isRosaryExpired(r));
    },

    // Get only joined rosaries that haven't expired
    getActiveJoinedRosaries() {
        return this.getJoinedRosaries().filter(r => {
            // Joined rosaries may not have a date field, check via saved rosaries
            if (r.date) return !this.isRosaryExpired(r);
            // Look up the original rosary to check its date
            const original = this.getRosaries().find(o => o.id === r.id);
            if (original) return !this.isRosaryExpired(original);
            return true; // Keep if we can't determine expiry
        });
    },

    // Auto-select the best rosary for the Rezar screen
    async getAutoRosary() {
        var user = auth.isAuthenticated() ? auth.getCurrentUser() : null;
        if (!user) return null;
        
        var userName = (user.name || '').toLowerCase().trim();
        var now = new Date();
        
        // Merge local + Supabase rosaries for full coverage
        var localRosaries = this.getActiveRosaries();
        var allActive = [].concat(localRosaries);
        
        // Fetch from Supabase to include rosaries created on other devices
        if (typeof db !== 'undefined' && db.getRosaries) {
            try {
                var remote = await db.getRosaries();
                if (remote && remote.length > 0) {
                    var localIds = {};
                    allActive.forEach(function(r) { localIds[r.id] = true; });
                    remote.forEach(function(r) {
                        if (!localIds[r.id]) {
                            // Convert Supabase format to local format
                            allActive.push({
                                id: r.id, place: r.place, date: r.date, time: r.time,
                                mystery: r.mystery, intention: r.intention,
                                creatorId: r.creator_id, creatorName: r.creator_name,
                                participants: r.participants || 1, address: r.address,
                                lat: r.lat, lng: r.lng
                            });
                        }
                    });
                }
            } catch(e) { console.warn('[Auto] Supabase fetch failed:', e.message); }
        }
        
        // Helper: calculate time distance from now (in minutes)
        function timeDistance(r) {
            if (!r.date || !r.time) return 999999;
            var dt = new Date(r.date + 'T' + r.time);
            return Math.abs(dt.getTime() - now.getTime()) / 60000;
        }
        
        // 1. Priority: Rosary the user COORDINATES (closest to now)
        var supabaseUserId = null;
        var sbSession = localStorage.getItem('sb-spplofkotgvumfkeltsr-auth-token');
        if (sbSession) { try { var p = JSON.parse(sbSession); supabaseUserId = p.user ? p.user.id : null; } catch(e) {} }
        
        var coordinated = allActive.filter(function(r) {
            if (r.creatorId && supabaseUserId && r.creatorId === supabaseUserId) return true;
            if (r.creatorId && user && r.creatorId === user.id) return true;
            if (r.creatorName && userName && r.creatorName.toLowerCase().trim() === userName) return true;
            return false;
        }).sort(function(a, b) { return timeDistance(a) - timeDistance(b); });
        
        if (coordinated.length > 0) {
            console.log('[Auto] Selected coordinated rosary:', coordinated[0].place);
            return coordinated[0];
        }
        
        // 2. Fallback: Rosary the user JOINED (closest to now)
        var joined = this.getActiveJoinedRosaries().sort(function(a, b) {
            return timeDistance(a) - timeDistance(b);
        });
        
        if (joined.length > 0) {
            var j = joined[0];
            console.log('[Auto] Selected joined rosary:', j.name);
            // Try to enrich with creator info from allActive list
            var enriched = allActive.find(function(r) { return r.id === j.id; });
            var creatorId = (enriched && enriched.creatorId) ? enriched.creatorId : (j.creatorId || null);
            var creatorName = (enriched && enriched.creatorName) ? enriched.creatorName : (j.creatorName || 'Anónimo');
            return { id: j.id, place: j.name, time: j.time, mystery: j.mystery, intention: j.intention, date: j.date, participants: j.participants || 1, creatorId: creatorId, creatorName: creatorName };
        }
        
        // 3. Last fallback: Any active rosary closest to now
        var closest = allActive.sort(function(a, b) { return timeDistance(a) - timeDistance(b); });
        if (closest.length > 0) {
            console.log('[Auto] Selected closest rosary:', closest[0].place);
            return closest[0];
        }
        
        return null;
    },

    saveRosary(r) {
        // Save locally
        const a = this.getRosaries(); a.push(r); localStorage.setItem(this.ROSARY_STORAGE_KEY, JSON.stringify(a));
        // Sync to Supabase
        if (typeof db !== 'undefined' && db.createRosary) {
            // Try to get the Supabase user UUID from the session storage
            var supabaseCreatorId = null;
            var sbSession = localStorage.getItem('sb-spplofkotgvumfkeltsr-auth-token');
            if (sbSession) {
                try {
                    var parsed = JSON.parse(sbSession);
                    supabaseCreatorId = parsed.user ? parsed.user.id : null;
                } catch(e) {}
            }
            console.log('[SaveRosary] Local creatorId:', r.creatorId, '| Supabase UUID:', supabaseCreatorId);
            var payload = {
                place: r.place, address: r.address || '', date: r.date, time: r.time,
                mystery: r.mystery, intention: r.intention, lat: r.lat, lng: r.lng,
                creator_name: r.creatorName || 'Anónimo', participants: r.participants || 1
            };
            // Only include creator_id if we have a valid Supabase UUID (it's a FK to profiles.id)
            if (supabaseCreatorId) {
                payload.creator_id = supabaseCreatorId;
            }
            db.createRosary(payload).then(function(result) {
                console.log('✅ Rosario guardado en Supabase, id:', result.id);
                // Update local rosary with Supabase ID for dedup
                if (result.id && result.id !== r.id) {
                    r.supabaseId = result.id;
                    // Update localStorage with the supabaseId
                    try {
                        var stored = JSON.parse(localStorage.getItem('redmaria_rosaries') || '[]');
                        var found = stored.find(function(s) { return s.id === r.id; });
                        if (found) { found.supabaseId = result.id; localStorage.setItem('redmaria_rosaries', JSON.stringify(stored)); }
                    } catch(e) {}
                }
            }).catch(function(e) { console.error('❌ Error guardando rosario en Supabase:', e.message || e); });
        }
    },


    addRosaryCard(rosary) {
        const list = document.getElementById('rosary-list'); if (!list) return;
        const ds = this.formatDate(rosary.date);
        const joined = this.getJoinedRosaries();
        const isJoined = joined.some(j => j.id === rosary.id);
        const card = document.createElement('div');
        card.className = 'rosary-card glass card';
        card.onclick = () => { app._currentRosary = rosary; app.navigate('screen-rezo'); };
        var addrHtml = rosary.address ? '<div class="rosary-card-detail"><i class="ri-road-map-fill"></i> ' + rosary.address + '</div>' : '';
        var btnLabel = isJoined ? '<i class="ri-check-line"></i> Unido' : '<i class="ri-add-circle-line"></i> Unirme';
        var btnClass = isJoined ? 'btn btn-secondary-outline btn-join' : 'btn btn-primary btn-join';
        card.innerHTML = '<div class="rosary-card-header"><div class="rosary-card-icon"><i class="ri-map-pin-fill"></i></div><div class="rosary-card-info"><h3>' + rosary.place + '</h3><p>' + ds + ' ' + rosary.time + ' hs · Misterios ' + rosary.mystery + '</p></div></div><div class="rosary-card-details">' + addrHtml + '<div class="rosary-card-detail"><i class="ri-candle-fill"></i> ' + rosary.intention + '</div><div class="rosary-card-detail"><i class="ri-group-fill"></i> ' + (rosary.participants || 1) + ' Participantes</div></div><button class="' + btnClass + '" data-rosary-id="' + rosary.id + '">' + btnLabel + '</button>';
        // Attach join handler to button (stopPropagation to not trigger card click)
        var btn = card.querySelector('.btn-join');
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            app._currentRosary = rosary;
            if (!isJoined) {
                app.joinRosary(rosary.id, rosary.place || 'Rosario', rosary.time || '', rosary.mystery || '', rosary.intention || '', rosary.participants || 1, rosary.date || '');
                btn.innerHTML = '<i class="ri-check-line"></i> Unido';
                btn.className = 'btn btn-secondary-outline btn-join';
            }
            app.navigate('screen-rezo');
        });
        list.appendChild(card);
    },

    formatDate(s) {
        if (!s) return '';
        const d = new Date(s + 'T00:00:00'), t = new Date(); t.setHours(0,0,0,0);
        if (d.getTime() === t.getTime()) return 'Hoy';
        if (d.getTime() === t.getTime() + 86400000) return 'Mañana';
        return d.getDate() + ' ' + ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()];
    },

    setupCreateRosaryForm() {
        const form = document.getElementById('create-rosary-form'); if (!form) return;
        const di = document.getElementById('rosary-date'); if (di) { const td = new Date().toISOString().split('T')[0]; di.min = td; di.value = td; }
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const country = document.getElementById('rosary-country') ? document.getElementById('rosary-country').value : '';
            const citySelect = document.getElementById('rosary-city') ? document.getElementById('rosary-city').value : '';
            const ciudadInput = document.getElementById('rosary-ciudad') ? document.getElementById('rosary-ciudad').value.trim() : '';
            const city = ciudadInput || citySelect;
            const place = document.getElementById('rosary-place').value.trim();
            const date = document.getElementById('rosary-date').value;
            const time = document.getElementById('rosary-time').value;
            
            let hasErr = false;
            [
                {id:'rosary-country', v:country, m:'Selecciona un país'},
                {id:'rosary-ciudad', v:city, m:'Ingresa una ciudad'},
                {id:'rosary-place', v:place, m:'Obligatorio'},
                {id:'rosary-date', v:date, m:'Obligatoria'},
                {id:'rosary-time', v:time, m:'Obligatoria'}
            ].forEach(f => {
                const el = document.getElementById(f.id), g = el?.closest('.auth-field'), er = g?.querySelector('.field-error');
                if (!f.v) { if (g) g.classList.add('has-error'); if (er) er.textContent = f.m; hasErr = true; }
                else { if (g) { g.classList.remove('has-error'); g.classList.add('has-success'); } if (er) er.textContent = ''; }
            });
            if (!this.pickerLocation) { const le = document.getElementById('rosary-location-error'); if (le) le.textContent = 'Marca una ubicación'; hasErr = true; }
            if (hasErr) { form.classList.add('shake'); setTimeout(() => form.classList.remove('shake'), 500); return; }
            const btn = form.querySelector('.btn-auth-submit'); btn.classList.add('loading'); btn.disabled = true;
            await new Promise(r => setTimeout(r, 800));
            const user = auth.getCurrentUser();
            const address = document.getElementById('rosary-address') ? document.getElementById('rosary-address').value.trim() : '';
            const countryName = document.getElementById('rosary-country') ? document.getElementById('rosary-country').options[document.getElementById('rosary-country').selectedIndex].text : '';
            const rosary = { id: Date.now().toString(36)+Math.random().toString(36).substr(2), place: auth.sanitize(place), address: auth.sanitize(address), country: country, countryName: countryName, city: city, date, time, mystery: '', intention: '', lat: this.pickerLocation.lat, lng: this.pickerLocation.lng, creatorId: user?.id||'anon', creatorName: user?.name||'Anónimo', createdAt: new Date().toISOString(), participants: 1 };
            this.saveRosary(rosary); this.addRosaryCard(rosary);
            btn.classList.remove('loading'); btn.disabled = false;
            form.reset(); this.pickerLocation = null;
            if (this.pickerMarker && this.pickerMap) { this.pickerMap.removeLayer(this.pickerMarker); this.pickerMarker = null; }
            const ov = document.getElementById('picker-overlay'); if (ov) ov.style.display = '';
            const co = document.getElementById('picker-coords'); if (co) { co.textContent = ''; co.classList.remove('visible'); }
            form.querySelectorAll('.auth-field').forEach(f => { f.classList.remove('has-success','has-error'); const e = f.querySelector('.field-error'); if (e) e.textContent = ''; });
            this.showRosaryDetail(rosary);
        });
    },

    showRosaryDetail(rosary) {
        const ds = this.formatDate(rosary.date);
        const user = auth.getCurrentUser();
        const details = document.getElementById('create-success-details');
        details.innerHTML = '<div class="success-detail-row"><i class="ri-map-pin-fill"></i> ' + rosary.place + '</div>' +
            (rosary.city ? '<div class="success-detail-row"><i class="ri-building-fill"></i> ' + rosary.city + ', ' + (rosary.countryName || '') + '</div>' : '') +
            (rosary.address ? '<div class="success-detail-row"><i class="ri-road-map-fill"></i> ' + rosary.address + '</div>' : '') +
            '<div class="success-detail-row"><i class="ri-calendar-fill"></i> ' + ds + ' ' + rosary.time + ' hs</div>' +
            '<div class="success-detail-row"><i class="ri-sparkling-fill"></i> Misterios ' + rosary.mystery + '</div>' +
            '<div class="success-detail-row"><i class="ri-candle-fill"></i> ' + rosary.intention + '</div>' +
            '<div class="success-detail-row"><i class="ri-user-fill"></i> Organizado por: ' + (user?.name || 'Tú') + '</div>';
        document.getElementById('create-rosary-form-wrapper').style.display = 'none';
        document.getElementById('create-success-banner').style.display = '';
    },

    resetCreateForm() {
        document.getElementById('create-success-banner').style.display = 'none';
        document.getElementById('create-rosary-form-wrapper').style.display = '';
        const form = document.getElementById('create-rosary-form');
        if (form) form.reset();
        const citySelect = document.getElementById('rosary-city');
        if (citySelect) { citySelect.innerHTML = '<option value="">Primero selecciona un país...</option>'; citySelect.disabled = true; }
        this.pickerLocation = null;
        if (this.pickerMarker && this.pickerMap) { this.pickerMap.removeLayer(this.pickerMarker); this.pickerMarker = null; }
        const ov = document.getElementById('picker-overlay'); if (ov) ov.style.display = '';
        const co = document.getElementById('picker-coords'); if (co) { co.textContent = ''; co.classList.remove('visible'); }
    },

    // ---- Forgot / Reset Password ----
    setupForgotPasswordForm() {
        const form = document.getElementById('forgot-password-form'); if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('forgot-email').value.trim();
            const group = document.getElementById('forgot-email').closest('.auth-field');
            const errEl = group.querySelector('.field-error');
            if (!email || !auth.validators.email(email)) {
                group.classList.add('has-error'); errEl.textContent = 'Ingresa un email válido';
                return;
            }
            group.classList.remove('has-error'); group.classList.add('has-success'); errEl.textContent = '';
            const btn = form.querySelector('.btn-auth-submit'); btn.classList.add('loading'); btn.disabled = true;
            await new Promise(r => setTimeout(r, 1200));
            btn.classList.remove('loading'); btn.disabled = false;
            // Check user exists
            const users = auth.getUsers();
            const user = users.find(u => u.email === email.toLowerCase());
            if (!user) {
                group.classList.add('has-error'); errEl.textContent = 'No existe una cuenta con ese email';
                return;
            }
            // Generate 6-digit code
            this.recoveryEmail = email.toLowerCase();
            this.recoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
            // Navigate to reset screen and show code
            this.navigate('screen-reset-password');
            document.getElementById('recovery-code-value').textContent = this.recoveryCode;
        });
    },

    setupResetPasswordForm() {
        const form = document.getElementById('reset-password-form'); if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('reset-code').value.trim();
            const password = document.getElementById('reset-password').value;
            const confirm = document.getElementById('reset-confirm').value;
            let hasErr = false;
            // Validate code
            const codeGroup = document.getElementById('reset-code').closest('.auth-field');
            const codeErr = codeGroup.querySelector('.field-error');
            if (code !== this.recoveryCode) {
                codeGroup.classList.add('has-error'); codeErr.textContent = 'Código incorrecto'; hasErr = true;
            } else { codeGroup.classList.remove('has-error'); codeGroup.classList.add('has-success'); codeErr.textContent = ''; }
            // Validate password
            const pwGroup = document.getElementById('reset-password').closest('.auth-field');
            const pwErr = pwGroup.querySelector('.field-error');
            if (!auth.validators.password(password)) {
                pwGroup.classList.add('has-error'); pwErr.textContent = 'Min 8 chars, mayúscula, minúscula, número y especial'; hasErr = true;
            } else { pwGroup.classList.remove('has-error'); pwGroup.classList.add('has-success'); pwErr.textContent = ''; }
            // Validate confirm
            const cfGroup = document.getElementById('reset-confirm').closest('.auth-field');
            const cfErr = cfGroup.querySelector('.field-error');
            if (password !== confirm) {
                cfGroup.classList.add('has-error'); cfErr.textContent = 'Las contraseñas no coinciden'; hasErr = true;
            } else { cfGroup.classList.remove('has-error'); cfGroup.classList.add('has-success'); cfErr.textContent = ''; }
            if (hasErr) { form.classList.add('shake'); setTimeout(() => form.classList.remove('shake'), 500); return; }
            const btn = form.querySelector('.btn-auth-submit'); btn.classList.add('loading'); btn.disabled = true;
            // Update password
            const result = await auth.resetPassword(this.recoveryEmail, password);
            btn.classList.remove('loading'); btn.disabled = false;
            if (result.success) {
                let sb = form.querySelector('.form-success-banner');
                if (!sb) { sb = document.createElement('div'); sb.className = 'form-success-banner'; form.prepend(sb); }
                sb.innerHTML = '<i class="ri-checkbox-circle-fill"></i> ¡Contraseña actualizada!'; sb.classList.add('visible');
                this.recoveryCode = null; this.recoveryEmail = null;
                setTimeout(() => { sb.classList.remove('visible'); this.navigate('screen-login'); }, 2000);
            } else {
                let eb = form.querySelector('.form-error-banner');
                if (!eb) { eb = document.createElement('div'); eb.className = 'form-error-banner'; form.prepend(eb); }
                eb.innerHTML = '<i class="ri-error-warning-fill"></i> ' + result.error; eb.classList.add('visible');
                setTimeout(() => eb.classList.remove('visible'), 3000);
            }
        });
    },

    setupResetStrengthMeter() {
        const pw = document.getElementById('reset-password'); if (!pw) return;
        pw.addEventListener('input', () => {
            const s = auth.getPasswordStrength(pw.value);
            const meter = document.getElementById('reset-strength-meter');
            const label = document.getElementById('reset-strength-label');
            if (!meter || !label) return;
            const bars = meter.querySelectorAll('.strength-bar');
            bars.forEach((b, i) => { b.className = 'strength-bar'; if (i < s.level) b.classList.add('active', s.level === 1 ? 'weak' : s.level === 2 ? 'medium' : 'strong'); });
            label.textContent = s.label; label.className = 'password-strength-label ' + (s.level === 1 ? 'weak' : s.level === 2 ? 'medium' : 'strong');
        });
    },

    isDesktop() { return window.innerWidth >= 1024; },

    navigate(screenId) {
        if (!this.screens.includes(screenId)) return;
        if (auth.isProtected(screenId) && !auth.isAuthenticated()) screenId = 'screen-login';
        const ac = document.getElementById('app-container');
        const single = ['screen-splash','screen-live','screen-rezo','screen-register','screen-login','screen-forgot-password','screen-reset-password','screen-map','screen-intenciones','screen-create-rosary','screen-rosary-detail','screen-como-rezar','screen-profile','screen-porque-rezar','screen-chat','screen-apariciones','screen-cenaculo','screen-iglesias'];
        const isDash = !single.includes(screenId);
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        if (this.isDesktop() && isDash) {
            ac.classList.add('dashboard-mode');
            ['screen-map','screen-profile'].forEach(s => document.getElementById(s).classList.add('active'));
        } else {
            ac.classList.remove('dashboard-mode');
            document.getElementById(screenId).classList.add('active');
        }
        this.currentScreen = screenId;
        this.updateHeaderNav(screenId); this.updateNavVisibility(screenId);

        if (screenId === 'screen-create-rosary') setTimeout(() => this.initPickerMap(), 400);
        if (screenId === 'screen-map') setTimeout(() => this.initBuscarMap(), 400);
        if (screenId === 'screen-rosary-detail' && this.detailMap) setTimeout(() => this.detailMap.invalidateSize(), 350);
        if (screenId === 'screen-rezo') {
            if (!this._counterStarted) { this._counterStarted = true; this.startOnlineCounter(); }
            // Auto-select rosary if none selected (async to check Supabase too)
            var self = this;
            if (!this._currentRosary) {
                this.getAutoRosary().then(function(auto) {
                    self._currentRosary = auto;
                    if (typeof updateRezoPage === 'function') {
                        updateRezoPage(self._currentRosary || null);
                    }
                });
            } else {
                if (typeof updateRezoPage === 'function') {
                    updateRezoPage(this._currentRosary || null);
                }
            }
        }
        if (screenId === 'screen-live') this.renderContinuo();
        if (screenId === 'screen-como-rezar') this.highlightTodayMystery();
        if (screenId === 'screen-cenaculo') setTimeout(function() { if (typeof initCenaculoMap === 'function') initCenaculoMap(); }, 400);
        if (screenId === 'screen-intenciones') { if (typeof loadCommunityIntenciones === 'function') loadCommunityIntenciones(); }
        if (screenId === 'screen-profile' || isDash) this.updateUserUI();
    },

    updateHeaderNav(s) {
        // Desktop header (now with dropdown: Inicio, Buscar, Crear, Continuo, [Rezar dropdown trigger + 4 sub], Apariciones, Mensajes, Perfil)
        document.querySelectorAll('.header-nav > a, .header-dropdown-trigger, .header-dropdown-menu a').forEach(a => a.classList.remove('active'));
        const h = document.querySelectorAll('.header-nav > a');
        const dd = document.querySelectorAll('.header-dropdown-menu a');
        const dt = document.querySelector('.header-dropdown-trigger');
        if (s === 'screen-splash') h[0]?.classList.add('active');
        else if (s === 'screen-map') h[1]?.classList.add('active');
        else if (s === 'screen-create-rosary') h[2]?.classList.add('active');
        else if (s === 'screen-live') h[3]?.classList.add('active');
        else if (s === 'screen-rezo') { h[4]?.classList.add('active'); }
        else if (s === 'screen-intenciones') { dd[0]?.classList.add('active'); if(dt) dt.classList.add('active'); }
        else if (s === 'screen-como-rezar') { dd[1]?.classList.add('active'); if(dt) dt.classList.add('active'); }
        else if (s === 'screen-porque-rezar') { dd[2]?.classList.add('active'); if(dt) dt.classList.add('active'); }
        else if (s === 'screen-apariciones') { dd[3]?.classList.add('active'); if(dt) dt.classList.add('active'); }
        else if (s === 'screen-iglesias') h[5]?.classList.add('active');
        else if (s === 'screen-cenaculo') h[6]?.classList.add('active');
        else if (s === 'screen-chat') h[7]?.classList.add('active');
        else if (s === 'screen-profile') h[8]?.classList.add('active');
        // Mobile header
        document.querySelectorAll('.mobile-header-nav a').forEach(a => a.classList.remove('active'));
        const m = document.querySelectorAll('.mobile-header-nav a');
        if (s === 'screen-splash') m[0]?.classList.add('active');
        else if (s === 'screen-map') m[1]?.classList.add('active');
        else if (s === 'screen-create-rosary') m[2]?.classList.add('active');
        else if (s === 'screen-rezo') m[3]?.classList.add('active');
        else if (s === 'screen-como-rezar') m[4]?.classList.add('active');
        else if (s === 'screen-porque-rezar') m[5]?.classList.add('active');
        else if (s === 'screen-apariciones') m[6]?.classList.add('active');
        else if (s === 'screen-iglesias') m[7]?.classList.add('active');
        else if (s === 'screen-cenaculo') m[8]?.classList.add('active');
        else if (s === 'screen-chat') m[9]?.classList.add('active');
        else if (s === 'screen-profile') m[10]?.classList.add('active');
    },

    toggleMobileMenu() {
        const nav = document.getElementById('mobile-nav-links');
        const btn = document.querySelector('#hamburger-btn i');
        nav.classList.toggle('open');
        btn.className = nav.classList.contains('open') ? 'ri-close-line' : 'ri-menu-line';
    },

    mobileNav(screenId) {
        this.navigate(screenId);
        const nav = document.getElementById('mobile-nav-links');
        const btn = document.querySelector('#hamburger-btn i');
        nav.classList.remove('open');
        btn.className = 'ri-menu-line';
    },

    updateNavVisibility(s) {
        const nav = document.getElementById('main-nav');
        const hideScreens = ['screen-register','screen-login','screen-forgot-password','screen-reset-password'];
        if (hideScreens.includes(s)) {
            nav.style.transform='translateY(100%)'; nav.style.opacity='0'; nav.style.pointerEvents='none';
        } else {
            nav.style.transform='translateY(0)'; nav.style.opacity='1'; nav.style.pointerEvents='all';
            // Map screens to nav items
            const navMap = {
                'screen-splash': 0,
                'screen-map': 1,
                'screen-create-rosary': 2,
                'screen-rezo': 3,
                'screen-live': 4,
                'screen-iglesias': 5,
                'screen-cenaculo': 6,
                'screen-chat': 7,
                'screen-profile': 8,
                'screen-rosary-detail': 1,
                'screen-como-rezar': 3,
                'screen-porque-rezar': 3,
                'screen-apariciones': 3,
                'screen-intenciones': 3,
                'screen-event': 1
            };
            const items = document.querySelectorAll('#main-nav .nav-item');
            items.forEach(el => el.classList.remove('active'));
            const idx = navMap[s];
            if (idx !== undefined && items[idx]) items[idx].classList.add('active');
        }
    },

    onAuthSuccess() { this.updateUserUI(); if (typeof loadAvatar === 'function') loadAvatar(); this.navigate('screen-profile'); this.requestGeolocation(); },
    handleLogout() { auth.logoutUser(); if (typeof setAvatarEverywhere === 'function') setAvatarEverywhere(null); this.navigate('screen-splash'); },

    requestGeolocation() {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                localStorage.setItem('redmaria_location', JSON.stringify(loc));
                // Reverse geocode to get city name
                fetch('https://nominatim.openstreetmap.org/reverse?lat=' + loc.lat + '&lon=' + loc.lng + '&format=json&accept-language=es')
                    .then(r => r.json())
                    .then(data => {
                        const city = data.address?.city || data.address?.town || data.address?.village || data.address?.state || '';
                        if (city) {
                            const pc = document.getElementById('profile-user-city');
                            if (pc) pc.textContent = city;
                            localStorage.setItem('redmaria_user_city', city);
                        }
                    }).catch(function(){});
            },
            function(err) {
                console.log('Geolocation denied:', err.message);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    },

    updateUserUI() {
        const u = auth.getCurrentUser(); if (!u) return;
        const pn = document.getElementById('profile-user-name'), pc = document.getElementById('profile-user-city'), pa = document.getElementById('profile-avatar-placeholder');
        if (pn) pn.textContent = u.name; if (pc) pc.textContent = u.city; if (pa) pa.textContent = u.name.charAt(0).toUpperCase();
        const hn = document.getElementById('header-user-name'); if (hn) hn.textContent = u.name;
        const hm = document.getElementById('header-avatar-mini'); if (hm) hm.textContent = u.name.charAt(0).toUpperCase();
        // Restore saved city from geolocation
        const savedCity = localStorage.getItem('redmaria_user_city');
        if (savedCity && pc) pc.textContent = savedCity;

        // Restore saved bio
        const savedBio = localStorage.getItem('redmaria_user_bio');
        const bioText = document.getElementById('profile-bio-text');
        if (bioText) {
            if (savedBio) {
                bioText.textContent = '"' + savedBio + '"';
                bioText.style.fontStyle = 'normal';
                bioText.style.color = 'var(--clr-text-title)';
            } else {
                bioText.textContent = '"Toca aquí para agregar una frase que te represente..."';
                bioText.style.fontStyle = 'italic';
                bioText.style.color = 'var(--clr-text-muted)';
            }
        }
        if (typeof db !== 'undefined' && db.getProfile) {
            db.getProfile(u.id).then(function(p) {
                if (p && p.bio) {
                    localStorage.setItem('redmaria_user_bio', p.bio);
                    if (bioText) {
                        bioText.textContent = '"' + p.bio + '"';
                        bioText.style.fontStyle = 'normal';
                        bioText.style.color = 'var(--clr-text-title)';
                    }
                }
                if (p && p.likes !== undefined) {
                    var countEl = document.querySelector('.profile-like-count');
                    if (countEl) countEl.textContent = p.likes;
                }
            }).catch(function(e) { console.warn('[Profile] Error loading profile details:', e); });
        }

        // Render each section independently so one error doesn't block the rest
        try { this.renderProfileSlots(); } catch(e) { console.error('[Profile] renderProfileSlots error:', e); }
        try { this.renderProfileJoined(); } catch(e) { console.error('[Profile] renderProfileJoined error:', e); }
        try { this.renderProfileMyRosaries(); } catch(e) { console.error('[Profile] renderProfileMyRosaries error:', e); }
    },

    renderProfileSlots() {
        const container = document.getElementById('profile-my-slots'); if (!container) return;
        const session = auth.isAuthenticated() ? JSON.parse(localStorage.getItem('redmaria_session')) : null;
        if (!session) return;
        const userName = session.name;
        const all = JSON.parse(localStorage.getItem(this.CONTINUO_KEY) || '{}');
        const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
        const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        const mySlots = [];

        for (const dateKey in all) {
            const slots = all[dateKey];
            for (const h in slots) {
                let people = slots[h];
                if (typeof people === 'string') people = [people];
                if (!Array.isArray(people)) continue; // skip corrupt data
                if (people.includes(userName)) {
                    const d = new Date(dateKey + 'T00:00:00');
                    const today = new Date(); today.setHours(0,0,0,0);
                    const tomorrow = new Date(today.getTime() + 86400000);
                    let dayLabel;
                    if (d.getTime() === today.getTime()) dayLabel = 'Hoy';
                    else if (d.getTime() === tomorrow.getTime()) dayLabel = 'Mañana';
                    else dayLabel = days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()];
                    const hour = parseInt(h);
                    const hourStr = hour.toString().padStart(2, '0') + ':00';
                    const nextHourStr = ((hour + 1) % 24).toString().padStart(2, '0') + ':00';
                    mySlots.push({ dateKey, date: d, dayLabel, hour, hourStr, nextHourStr, count: people.length });
                }
            }
        }

        // Sort by date and hour
        mySlots.sort((a, b) => a.date - b.date || a.hour - b.hour);

        if (mySlots.length === 0) {
            container.innerHTML = '<div class="profile-no-slots glass card"><i class="ri-calendar-line"></i><p>Aún no te anotaste a ningún turno</p><button class="btn btn-primary" onclick="app.navigate(\'screen-live\')"><i class="ri-add-line"></i> Anotarme</button></div>';
            return;
        }

        let html = '';
        mySlots.forEach(s => {
            html += '<div class="profile-slot-card glass card">' +
                '<div class="profile-slot-left">' +
                    '<div class="profile-slot-icon"><i class="ri-time-line"></i></div>' +
                    '<div class="profile-slot-info">' +
                        '<h4>' + s.hourStr + ' - ' + s.nextHourStr + '</h4>' +
                        '<p><i class="ri-calendar-event-fill"></i> ' + s.dayLabel + '</p>' +
                        '<span class="profile-slot-people"><i class="ri-group-fill"></i> ' + s.count + ' persona' + (s.count > 1 ? 's' : '') + '</span>' +
                    '</div>' +
                '</div>' +
                '<button class="profile-slot-cancel" onclick="app.cancelSlot(\'' + s.dateKey + '\',' + s.hour + '); app.renderProfileSlots();" title="Cancelar turno"><i class="ri-close-circle-line"></i></button>' +
            '</div>';
        });
        container.innerHTML = html;
    },

    generateSplashBeads() { const c = document.getElementById('splash-beads'); for (let i=0;i<44;i++) { const a=(i/44)*Math.PI*2; if(a>Math.PI*0.35&&a<Math.PI*0.65)continue; const b=document.createElement('div'); b.className='rosary-bead'; b.style.left=(90+80*Math.cos(a))+'px'; b.style.top=(90+80*Math.sin(a))+'px'; c.appendChild(b); } },
    generateLiveBeads() { const c=document.getElementById('live-beads'); for(let i=0;i<7;i++){const b=document.createElement('div');b.className='live-bead';if(i===3)b.classList.add('active');c.appendChild(b);} },
    generateParticipants() {
        // No fake participants - real data only
    },
    startOnlineCounter() { /* disabled - no fake counter */ },

    // ---- ROSARIO CONTINUO ----
    continuoChangeDay(delta) {
        this.continuoDate.setDate(this.continuoDate.getDate() + delta);
        this.renderContinuo();
    },

    async getContinuoSlots(dateKey) {
        var all = JSON.parse(localStorage.getItem(this.CONTINUO_KEY) || '{}');
        if (!all[dateKey]) all[dateKey] = {};
        
        // Migrate string values to arrays in local
        for (var h in all[dateKey]) {
            if (typeof all[dateKey][h] === 'string') all[dateKey][h] = [all[dateKey][h]];
            if (!Array.isArray(all[dateKey][h])) all[dateKey][h] = [];
        }
        
        // Supabase is the SOURCE OF TRUTH when available
        if (typeof db !== 'undefined' && db.getContinuoSlots) {
            try {
                var remote = await db.getContinuoSlots(dateKey);
                if (remote && typeof remote === 'object') {
                    // Replace local with Supabase data entirely for this date
                    var supabaseSlots = {};
                    for (var rh in remote) {
                        supabaseSlots[rh] = Array.isArray(remote[rh]) ? remote[rh] : [remote[rh]];
                    }
                    // Also include any LOCAL-ONLY entries added in the last 10 seconds
                    // (to handle the gap between local save and Supabase propagation)
                    var localSlots = all[dateKey] || {};
                    var recentKey = '_continuo_recent_' + dateKey;
                    var recentRaw = localStorage.getItem(recentKey);
                    if (recentRaw) {
                        try {
                            var recent = JSON.parse(recentRaw);
                            var now = Date.now();
                            // Add recent local entries not yet in Supabase (within 10s)
                            recent.forEach(function(entry) {
                                if (now - entry.ts < 10000) {
                                    var hr = entry.hour;
                                    if (!supabaseSlots[hr]) supabaseSlots[hr] = [];
                                    if (!supabaseSlots[hr].includes(entry.name)) {
                                        supabaseSlots[hr].push(entry.name);
                                    }
                                }
                            });
                            // Clean old entries
                            var fresh = recent.filter(function(e) { return now - e.ts < 10000; });
                            if (fresh.length > 0) localStorage.setItem(recentKey, JSON.stringify(fresh));
                            else localStorage.removeItem(recentKey);
                        } catch(e) { localStorage.removeItem(recentKey); }
                    }
                    all[dateKey] = supabaseSlots;
                    localStorage.setItem(this.CONTINUO_KEY, JSON.stringify(all));
                    console.log('[Continuo] Using Supabase as source of truth for', dateKey);
                    return supabaseSlots;
                }
            } catch(e) { console.warn('[Continuo] Supabase failed, using local:', e.message); }
        }
        
        // Fallback: use localStorage only (offline mode)
        console.log('[Continuo] Using localStorage fallback for', dateKey);
        return all[dateKey] || {};
    },

    async renderContinuo() {
        const d = this.continuoDate;
        const today = new Date();
        const isToday = d.toDateString() === today.toDateString();
        const isTomorrow = new Date(today.getTime() + 86400000).toDateString() === d.toDateString();
        const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
        const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const titleEl = document.getElementById('continuo-date-title');
        const subEl = document.getElementById('continuo-date-sub');
        if (titleEl) titleEl.textContent = isToday ? 'Hoy' : (isTomorrow ? 'Mañana' : days[d.getDay()]);
        if (subEl) subEl.textContent = d.getDate() + ' de ' + months[d.getMonth()] + ', ' + d.getFullYear();

        const dateKey = this.localDateKey(d);
        const slots = await this.getContinuoSlots(dateKey);
        const user = auth.isAuthenticated() ? JSON.parse(localStorage.getItem('redmaria_session')).name : null;
        const grid = document.getElementById('continuo-grid');
        if (!grid) return;
        grid.innerHTML = '';
        let totalPeople = 0;

        for (let h = 0; h < 24; h++) {
            const card = document.createElement('div');
            const hour = h.toString().padStart(2, '0') + ':00';
            const nextHour = ((h + 1) % 24).toString().padStart(2, '0') + ':00';
            let people = slots[h] || [];
            if (typeof people === 'string') people = [people];
            if (!Array.isArray(people)) people = [];
            const count = people.length;
            const isMine = user && people.includes(user);
            totalPeople += count;

            if (count > 0) {
                card.className = 'slot-card ' + (isMine ? 'mine' : 'taken');
                card.innerHTML = '<div class="slot-hour">' + hour + '</div><div class="slot-count">' + count + '</div><div class="slot-status">' + (isMine ? '🙏 Tú + ' + (count - 1) : count + ' persona' + (count > 1 ? 's' : '')) + '</div>';
                card.onclick = () => this.showSlotSignup(dateKey, h, hour, nextHour);
            } else {
                card.className = 'slot-card free';
                card.innerHTML = '<div class="slot-hour">' + hour + '</div><div class="slot-count">0</div><div class="slot-status">Libre</div>';
                card.onclick = () => this.showSlotSignup(dateKey, h, hour, nextHour);
            }
            grid.appendChild(card);
        }

        var takenEl = document.getElementById('continuo-taken');
        if (takenEl) takenEl.textContent = totalPeople;

        // Mis Turnos
        const mySection = document.getElementById('continuo-my-slots');
        const myList = document.getElementById('continuo-my-list');
        if (!myList) return;
        myList.innerHTML = '';
        let hasSlots = false;
        for (let h = 0; h < 24; h++) {
            let people = slots[h] || [];
            if (typeof people === 'string') people = [people];
            if (!Array.isArray(people)) people = [];
            if (user && people.includes(user)) {
                hasSlots = true;
                const hour = h.toString().padStart(2, '0') + ':00';
                const nextHour = ((h + 1) % 24).toString().padStart(2, '0') + ':00';
                const item = document.createElement('div');
                item.className = 'my-slot-item';
                item.innerHTML = '<div class="my-slot-info"><div class="my-slot-icon"><i class="ri-time-line"></i></div><div class="my-slot-text"><h4>' + hour + ' - ' + nextHour + '</h4><p>' + (subEl ? subEl.textContent : '') + '</p></div></div><button class="my-slot-cancel" onclick="app.cancelSlot(\'' + dateKey + '\',' + h + ')">Cancelar</button>';
                myList.appendChild(item);
            }
        }
        if (mySection) mySection.style.display = hasSlots ? 'block' : 'none';
    },

    showSlotSignup(dateKey, hour, hourStr, nextHourStr) {
        if (!auth.isAuthenticated()) { this.navigate('screen-login'); return; }
        const user = JSON.parse(localStorage.getItem('redmaria_session')).name;
        // Use the last rendered data (already synced from Supabase) instead of stale localStorage
        const all = JSON.parse(localStorage.getItem(this.CONTINUO_KEY) || '{}');
        const slots = all[dateKey] || {};
        let people = slots[hour] || [];
        if (typeof people === 'string') people = [people];
        if (!Array.isArray(people)) people = [];
        const alreadyIn = people.includes(user);
        // Parse date from dateKey to avoid timezone drift from continuoDate
        const dateParts = dateKey.split('-');
        const modalDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
        const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const dateStr = modalDate.getDate() + ' de ' + months[modalDate.getMonth()] + ', ' + modalDate.getFullYear();
        const modal = document.createElement('div');
        modal.className = 'slot-signup-modal';
        if (alreadyIn) {
            modal.innerHTML = '<div class="slot-signup-card"><h3>Cancelar Turno</h3><div class="slot-signup-time">' + hourStr + ' - ' + nextHourStr + '</div><div class="slot-signup-date">' + dateStr + '</div><p style="font-size:0.85rem;color:#5A7D9A;margin-bottom:12px">Ya estás anotado en este horario. ¿Deseas cancelar?</p><div class="slot-signup-actions"><button class="btn btn-secondary-outline" onclick="this.closest(\'.slot-signup-modal\').remove()">Volver</button><button class="btn btn-primary" id="confirm-slot-btn" style="background:linear-gradient(135deg,#e74c3c,#c0392b)">Cancelar Turno</button></div></div>';
            document.body.appendChild(modal);
            modal.querySelector('#confirm-slot-btn').onclick = () => { this.cancelSlot(dateKey, hour); modal.remove(); };
        } else {
            modal.innerHTML = '<div class="slot-signup-card"><h3>Anotarse al Rosario</h3><div class="slot-signup-time">' + hourStr + ' - ' + nextHourStr + '</div><div class="slot-signup-date">' + dateStr + '</div>' + (people.length > 0 ? '<p style="font-size:0.85rem;color:#5A7D9A;margin-bottom:12px">' + people.length + ' persona' + (people.length > 1 ? 's' : '') + ' ya anotada' + (people.length > 1 ? 's' : '') + '</p>' : '') + '<div class="slot-signup-actions"><button class="btn btn-secondary-outline" onclick="this.closest(\'.slot-signup-modal\').remove()">Cancelar</button><button class="btn btn-primary" id="confirm-slot-btn">Confirmar</button></div></div>';
            document.body.appendChild(modal);
            modal.querySelector('#confirm-slot-btn').onclick = () => { this.confirmSlot(dateKey, hour); modal.remove(); };
        }
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    },

    async confirmSlot(dateKey, hour) {
        const session = JSON.parse(localStorage.getItem('redmaria_session'));
        if (!session) return;
        // Save locally for immediate feedback
        const all = JSON.parse(localStorage.getItem(this.CONTINUO_KEY) || '{}');
        if (!all[dateKey]) all[dateKey] = {};
        if (!all[dateKey][hour]) all[dateKey][hour] = [];
        if (typeof all[dateKey][hour] === 'string') all[dateKey][hour] = [all[dateKey][hour]];
        if (!all[dateKey][hour].includes(session.name)) all[dateKey][hour].push(session.name);
        localStorage.setItem(this.CONTINUO_KEY, JSON.stringify(all));
        // Track as recent entry (for instant feedback before Supabase propagates)
        var recentKey = '_continuo_recent_' + dateKey;
        var recent = [];
        try { recent = JSON.parse(localStorage.getItem(recentKey) || '[]'); } catch(e) { recent = []; }
        recent.push({ hour: hour, name: session.name, ts: Date.now() });
        localStorage.setItem(recentKey, JSON.stringify(recent));
        // Sync to Supabase (await so renderContinuo reads fresh data)
        if (typeof db !== 'undefined' && db.addContinuoSlot) {
            await db.addContinuoSlot(dateKey, hour, session.name);
        }
        this.renderContinuo();
    },

    async cancelSlot(dateKey, hour) {
        const session = JSON.parse(localStorage.getItem('redmaria_session'));
        if (!session) return;
        // Remove locally
        const all = JSON.parse(localStorage.getItem(this.CONTINUO_KEY) || '{}');
        if (all[dateKey] && all[dateKey][hour]) {
            if (typeof all[dateKey][hour] === 'string') all[dateKey][hour] = [all[dateKey][hour]];
            all[dateKey][hour] = all[dateKey][hour].filter(n => n !== session.name);
            if (all[dateKey][hour].length === 0) delete all[dateKey][hour];
        }
        localStorage.setItem(this.CONTINUO_KEY, JSON.stringify(all));
        // Sync to Supabase
        if (typeof db !== 'undefined' && db.removeContinuoSlot) {
            await db.removeContinuoSlot(dateKey, hour, session.name);
        }
        this.renderContinuo();
    },

    highlightTodayMystery() {
        const el = document.getElementById('rezar-today-highlight');
        if (!el) return;
        const day = new Date().getDay(); // 0=Dom, 1=Lun...
        const dayMap = { 0: 'Gloriosos', 1: 'Gozosos', 2: 'Dolorosos', 3: 'Gloriosos', 4: 'Luminosos', 5: 'Dolorosos', 6: 'Gozosos' };
        const dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
        const mystery = dayMap[day];
        const colorMap = { 'Gozosos': '#56d992', 'Dolorosos': '#e74c3c', 'Gloriosos': '#f0a500', 'Luminosos': '#3DA3D4' };
        el.innerHTML = '<i class="ri-calendar-check-fill"></i> Hoy es <strong>' + dayNames[day] + '</strong> — rezamos los <strong>Misterios ' + mystery + '</strong>';
        el.style.borderLeft = '4px solid ' + (colorMap[mystery] || '#3DA3D4');
    },

    addIntencion() {
        const ta = document.getElementById('intencion-text');
        const text = ta?.value.trim();
        if (!text) { ta?.focus(); return; }
        const user = auth.isAuthenticated() ? auth.getCurrentUser() : null;
        if (!user) { this.navigate('screen-login'); return; }
        const name = user.name || 'Anónimo';
        const initial = name.charAt(0).toUpperCase();
        const colors = ['#A8C4DE','#F4D35E','#B5D6A7','#E8A0BF','#C4B5FD','#8FACC5','#FFB4A2','#89CFF0','#FFC6FF','#CAFFBF'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const color2 = colors[(Math.floor(Math.random() * colors.length) + 3) % colors.length];

        // Build intention object (same format as rezo intenciones for unification)
        var intencion = {
            id: Date.now().toString(36),
            name: name,
            initial: initial,
            text: text,
            color: color,
            color2: color2,
            time: new Date().toISOString()
        };

        // Save to shared localStorage (used by both Rezar and Intenciones screens)
        if (typeof getRezoIntenciones === 'function') {
            var list = getRezoIntenciones();
            list.push(intencion);
            saveRezoIntenciones(list);
        }

        // Update the community intentions list visually (on Intenciones screen)
        const communityList = document.getElementById('community-intentions-list');
        if (communityList) {
            const item = document.createElement('div');
            item.className = 'community-intention glass';
            item.style.animation = 'fadeInUp 0.4s ease-out';
            item.innerHTML = '<div class="ci-avatar" style="background:' + color + '">' + initial + '</div><div class="ci-content"><span class="ci-name">' + auth.sanitize(name) + '</span><p>' + auth.sanitize(text) + '</p></div><div class="ci-heart-area"><button class="ci-heart-btn" onclick="toggleHeart(this)"><i class="ri-heart-line"></i></button><span class="ci-heart-count">0</span></div>';
            communityList.insertBefore(item, communityList.firstChild);
        }

        // Also update the rezo intenciones list if it exists (on Rezar screen)
        if (typeof renderRezoIntenciones === 'function') {
            renderRezoIntenciones();
        }

        ta.value = '';

        // Sync to Supabase with user name
        if (typeof db !== 'undefined' && db.createIntencion) {
            db.createIntencion({ text: text, user_name: name })
                .then(function(result) { console.log('[Intenciones] Saved to Supabase'); })
                .catch(function(e) { console.error('[Intenciones] Sync error:', e); });
        }
    }
};

// Init app
document.addEventListener('DOMContentLoaded', function() {
    app.init();
});

// Ensure global access for inline onclick handlers
window.app = app;

// Profile Bio functions
function editProfileBio() {
    var textEl = document.getElementById('profile-bio-text');
    var editorEl = document.getElementById('profile-bio-editor');
    if (textEl) textEl.style.display = 'none';
    if (editorEl) editorEl.style.display = 'flex';
    var savedBio = localStorage.getItem('redmaria_user_bio') || '';
    var inputEl = document.getElementById('profile-bio-input');
    if (inputEl) {
        inputEl.value = savedBio;
        inputEl.focus();
    }
}

function cancelEditBio() {
    var textEl = document.getElementById('profile-bio-text');
    var editorEl = document.getElementById('profile-bio-editor');
    if (textEl) textEl.style.display = 'block';
    if (editorEl) editorEl.style.display = 'none';
}

function saveProfileBio() {
    var inputEl = document.getElementById('profile-bio-input');
    if (!inputEl) return;
    var bio = inputEl.value.trim();
    // check word count
    var words = bio.match(/\S+/g);
    var wordCount = words ? words.length : 0;
    if (wordCount > 80) {
        if (typeof showMsgToast === 'function') showMsgToast('La frase no puede tener más de 80 palabras.');
        return;
    }
    
    localStorage.setItem('redmaria_user_bio', bio);
    
    var bioText = document.getElementById('profile-bio-text');
    if (bioText) {
        if (bio) {
            bioText.textContent = '"' + bio + '"';
            bioText.style.fontStyle = 'normal';
            bioText.style.color = 'var(--clr-text-title)';
        } else {
            bioText.textContent = '"Toca aquí para agregar una frase que te represente..."';
            bioText.style.fontStyle = 'italic';
            bioText.style.color = 'var(--clr-text-muted)';
        }
    }
    
    cancelEditBio();
    
    var u = auth.getCurrentUser();
    if (u && typeof db !== 'undefined' && db.updateProfileBio) {
        db.updateProfileBio(u.id, bio).catch(function(e) { console.error('Error saving bio:', e); });
    }
}

function toggleProfileLike(el) {
    var icon = el.querySelector('.profile-like-icon');
    var countEl = el.querySelector('.profile-like-count');
    if (!icon || !countEl) return;
    
    var isLiked = icon.classList.contains('ri-heart-fill');
    var count = parseInt(countEl.textContent, 10) || 0;
    var increment = 0;
    
    if (isLiked) {
        icon.classList.remove('ri-heart-fill');
        icon.classList.add('ri-heart-line');
        icon.style.color = 'var(--clr-text-muted)';
        icon.style.transform = 'scale(1)';
        countEl.textContent = count - 1;
        increment = -1;
    } else {
        icon.classList.remove('ri-heart-line');
        icon.classList.add('ri-heart-fill');
        icon.style.color = '#e74c3c'; // Rojo
        icon.style.transform = 'scale(1.15)';
        countEl.textContent = count + 1;
        increment = 1;
    }

    var u = auth.getCurrentUser();
    if (u && typeof db !== 'undefined' && db.updateProfileLikes) {
        db.updateProfileLikes(u.id, increment).catch(function(e) { console.error('Error syncing likes:', e); });
    }
}
