// === SUPABASE CONFIG ===
var SUPABASE_URL = 'https://spplofkotgvumfkeltsr.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwcGxvZmtvdGd2dW1ma2VsdHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MDg3NDUsImV4cCI6MjA5MjM4NDc0NX0.GsPBPi0RbZBansH-9hBWW4iufUJBnXj89d-31nOmHM4';

// Initialize Supabase client (named sbClient to avoid conflict with window.supabase CDN)
var sbClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// === DATABASE SERVICE ===
var db = {

    // ==================== AUTH ====================
    async signUp(email, password, name) {
        if (!sbClient) return { error: 'Supabase no inicializado' };
        const { data, error } = await sbClient.auth.signUp({
            email,
            password,
            options: { data: { name: name, username: '@' + name.toLowerCase().replace(/\s+/g, '_') } }
        });
        if (!error && data.user) {
            await this.upsertProfile(data.user.id, name, email);
        }
        return { data, error };
    },

    async signIn(email, password) {
        if (!sbClient) return { error: 'Supabase no inicializado' };
        const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
        return { data, error };
    },

    async signOut() {
        if (!sbClient) return;
        await sbClient.auth.signOut();
    },

    async getUser() {
        if (!sbClient) return null;
        const { data } = await sbClient.auth.getUser();
        return data?.user || null;
    },

    async getSession() {
        if (!sbClient) return null;
        const { data } = await sbClient.auth.getSession();
        return data?.session || null;
    },

    // ==================== PROFILES ====================
    async upsertProfile(userId, name, email) {
        if (!sbClient) return;
        const username = '@' + name.toLowerCase().replace(/\s+/g, '_');
        await sbClient.from('profiles').upsert({
            id: userId,
            name: name,
            email: email,
            username: username,
            updated_at: new Date().toISOString()
        });
    },

    async getProfile(userId) {
        if (!sbClient) return null;
        const { data } = await sbClient.from('profiles').select('*').eq('id', userId).single();
        return data;
    },

    async searchUsers(query) {
        if (!sbClient) return [];
        const { data } = await sbClient.from('profiles')
            .select('id, name, username, email')
            .or(`username.ilike.%${query}%,name.ilike.%${query}%`)
            .limit(10);
        return data || [];
    },

    async getProfileByEmail(email) {
        if (!sbClient) return null;
        const { data } = await sbClient.from('profiles')
            .select('id, name, username, email')
            .eq('email', email)
            .single();
        return data;
    },

    // ==================== ROSARIOS ====================
    async createRosary(rosary) {
        if (!sbClient) { saveLocal('rosaries', rosary); return rosary; }
        // Don't send 'id' if it's not a valid UUID — let Supabase generate it
        var payload = Object.assign({}, rosary);
        if (payload.id && !/^[0-9a-f]{8}-/.test(payload.id)) {
            delete payload.id; // Remove non-UUID id, let DB auto-generate
        }
        console.log('[DB] Creating rosary with payload:', JSON.stringify(payload));
        const { data, error } = await sbClient.from('rosaries').insert(payload).select().single();
        if (error) {
            console.error('[DB] Error creating rosary:', error.message, '| Details:', error.details, '| Hint:', error.hint, '| Code:', error.code);
            saveLocal('rosaries', rosary);
            return rosary;
        }
        console.log('[DB] Rosary created successfully:', data.id);
        return data;
    },

    async getRosaries() {
        if (!sbClient) { console.warn('[DB] No sbClient, using local'); return getLocal('rosaries'); }
        const { data, error } = await sbClient.from('rosaries')
            .select('*')
            .gte('date', new Date().toISOString().split('T')[0])
            .order('date', { ascending: true });
        if (error) { console.error('[DB] Error loading rosaries:', error.message, error); return getLocal('rosaries'); }
        console.log('[DB] Rosaries from Supabase:', data ? data.length : 0);
        return data || [];
    },

    async joinRosary(rosaryId, userId) {
        if (!sbClient) return;
        console.log('[DB] Joining rosary:', rosaryId, 'user:', userId);
        const { error } = await sbClient.from('rosary_participants').upsert({
            rosary_id: rosaryId,
            user_id: userId,
            joined_at: new Date().toISOString()
        }, { onConflict: 'rosary_id,user_id' });
        if (error) {
            console.error('[DB] Error joining rosary:', error.message, '| Code:', error.code, '| Details:', error.details);
        } else {
            console.log('[DB] Successfully joined rosary');
        }
        // Increment participant count
        try { await sbClient.rpc('increment_participants', { row_id: rosaryId }); } catch(e) {}
    },

    async leaveRosary(rosaryId, userId) {
        if (!sbClient) return;
        const { error } = await sbClient.from('rosary_participants')
            .delete()
            .eq('rosary_id', rosaryId)
            .eq('user_id', userId);
        if (error) console.error('[DB] Error leaving rosary:', error.message);
        try { await sbClient.rpc('decrement_participants', { row_id: rosaryId }); } catch(e) {}
    },

    async getParticipants(rosaryId) {
        if (!sbClient) return [];
        console.log('[DB] Fetching participants for rosary:', rosaryId);
        // Get participant user_ids
        const { data, error } = await sbClient.from('rosary_participants')
            .select('user_id, joined_at')
            .eq('rosary_id', rosaryId)
            .order('joined_at', { ascending: true });
        if (error) {
            console.error('[DB] Error fetching participants:', error.message, '| Code:', error.code);
            return [];
        }
        if (!data || data.length === 0) return [];
        console.log('[DB] Found', data.length, 'participants');

        // Fetch names from profiles
        var userIds = data.map(function(p) { return p.user_id; });
        var profiles = {};
        try {
            const { data: profileData } = await sbClient.from('profiles')
                .select('id, name')
                .in('id', userIds);
            if (profileData) {
                profileData.forEach(function(pr) { profiles[pr.id] = pr.name; });
            }
        } catch(e) { console.warn('[DB] Could not fetch profile names:', e.message); }

        return data.map(function(p) {
            return { id: p.user_id, name: profiles[p.user_id] || 'Anónimo', role: 'participante' };
        });
    },

    // ==================== ROSARIO CONTINUO ====================
    async getContinuoSlots(dateKey) {
        if (!sbClient) return {};
        const { data, error } = await sbClient.from('continuo_slots')
            .select('hour, user_name, user_id')
            .eq('date_key', dateKey)
            .order('hour', { ascending: true });
        if (error) { console.error('[DB] Error loading continuo:', error.message); return {}; }
        // Convert to { hour: [name1, name2, ...] }
        var slots = {};
        (data || []).forEach(function(row) {
            if (!slots[row.hour]) slots[row.hour] = [];
            slots[row.hour].push(row.user_name);
        });
        console.log('[DB] Continuo slots for', dateKey, ':', Object.keys(slots).length, 'hours');
        return slots;
    },

    async addContinuoSlot(dateKey, hour, userName) {
        if (!sbClient) return;
        var userId = null;
        var sbSession = localStorage.getItem('sb-spplofkotgvumfkeltsr-auth-token');
        if (sbSession) { try { var p = JSON.parse(sbSession); userId = p.user ? p.user.id : null; } catch(e) {} }
        const { error } = await sbClient.from('continuo_slots').upsert({
            date_key: dateKey,
            hour: hour,
            user_id: userId,
            user_name: userName,
        }, { onConflict: 'date_key,hour,user_id' });
        if (error) console.error('[DB] Error adding continuo slot:', error.message);
        else console.log('[DB] Added continuo slot:', dateKey, hour, userName);
    },

    async removeContinuoSlot(dateKey, hour, userName) {
        if (!sbClient) return;
        var userId = null;
        var sbSession = localStorage.getItem('sb-spplofkotgvumfkeltsr-auth-token');
        if (sbSession) { try { var p = JSON.parse(sbSession); userId = p.user ? p.user.id : null; } catch(e) {} }
        const { error } = await sbClient.from('continuo_slots')
            .delete()
            .eq('date_key', dateKey)
            .eq('hour', hour)
            .eq('user_id', userId);
        if (error) console.error('[DB] Error removing continuo slot:', error.message);
        else console.log('[DB] Removed continuo slot:', dateKey, hour);
    },

    // ==================== CENACULOS ====================
    async createCenaculo(cenaculo) {
        if (!sbClient) { saveLocal('cenaculos', cenaculo); return cenaculo; }
        const { data, error } = await sbClient.from('cenaculos').insert({
            id: cenaculo.id,
            name: cenaculo.name,
            access: cenaculo.access,
            color: cenaculo.color,
            icon: cenaculo.icon,
            creator_id: cenaculo.creatorId,
            lat: cenaculo.lat || null,
            lng: cenaculo.lng || null
        }).select().single();
        if (error) { console.error('Error creating cenaculo:', error); saveLocal('cenaculos', cenaculo); return cenaculo; }

        // Add members
        if (cenaculo.members) {
            for (const m of cenaculo.members) {
                await sbClient.from('cenaculo_members').insert({
                    cenaculo_id: data.id,
                    user_id: m.profileId || null,
                    username: m.username || null,
                    name: m.name,
                    role: m.role
                });
            }
        }
        return data;
    },

    async getCenaculos(userId) {
        if (!sbClient) return getLocal('cenaculos');
        try {
            // Try join query first
            const { data, error } = await sbClient.from('cenaculos')
                .select('*, cenaculo_members(*)')
                .order('created_at', { ascending: false });
            if (!error && data) return data;
        } catch(e) {}
        // Fallback: separate queries
        const { data: cenaculos } = await sbClient.from('cenaculos')
            .select('*')
            .order('created_at', { ascending: false });
        if (!cenaculos) return [];
        for (const c of cenaculos) {
            const { data: members } = await sbClient.from('cenaculo_members')
                .select('*')
                .eq('cenaculo_id', c.id);
            c.cenaculo_members = members || [];
        }
        return cenaculos;
    },

    async addCenaculoMember(cenaculoId, username, name) {
        if (!sbClient) return;
        await sbClient.from('cenaculo_members').insert({
            cenaculo_id: cenaculoId,
            username: username,
            name: name,
            role: 'miembro'
        });
    },

    async leaveCenaculoDb(cenaculoId, userId) {
        if (!sbClient) return;
        await sbClient.from('cenaculo_members')
            .delete()
            .eq('cenaculo_id', cenaculoId)
            .eq('user_id', userId);
    },

    // ==================== INTENCIONES ====================
    async createIntencion(intencion) {
        if (!sbClient) { console.warn('Supabase no disponible'); return; }
        const { data, error } = await sbClient.from('intenciones').insert(intencion).select();
        if (error) {
            console.error('❌ Supabase insert error:', error.message, error.details, error.hint);
            throw error;
        }
        console.log('✅ Intención insertada:', data);
        return data;
    },

    async getIntenciones() {
        if (!sbClient) return [];
        const { data, error } = await sbClient.from('intenciones')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) console.error('Error fetching intenciones:', error);
        return data || [];
    },

    // ==================== MENSAJES (REAL) ====================
    async sendMessage(fromId, toId, text) {
        if (!sbClient) return null;
        const { data, error } = await sbClient.from('messages').insert({
            from_id: fromId,
            to_id: toId,
            text: text
        }).select().single();
        if (error) { console.error('Error sending message:', error); return null; }
        return data;
    },

    async getConversations(userId) {
        if (!sbClient) return [];
        // Get all messages involving this user, ordered by most recent
        const { data, error } = await sbClient.from('messages')
            .select('*')
            .or(`from_id.eq.${userId},to_id.eq.${userId}`)
            .order('created_at', { ascending: false });
        if (error) { console.error('Error getting conversations:', error); return []; }
        if (!data || data.length === 0) return [];

        // Group by conversation partner
        var convMap = {};
        data.forEach(function(msg) {
            var partnerId = msg.from_id === userId ? msg.to_id : msg.from_id;
            if (!convMap[partnerId]) {
                convMap[partnerId] = {
                    partnerId: partnerId,
                    lastMessage: msg,
                    unreadCount: 0
                };
            }
            if (msg.to_id === userId && !msg.read) {
                convMap[partnerId].unreadCount++;
            }
        });
        return Object.values(convMap);
    },

    async getConversationMessages(userId, partnerId) {
        if (!sbClient) return [];
        const { data, error } = await sbClient.from('messages')
            .select('*')
            .or(`and(from_id.eq.${userId},to_id.eq.${partnerId}),and(from_id.eq.${partnerId},to_id.eq.${userId})`)
            .order('created_at', { ascending: true });
        if (error) { console.error('Error getting messages:', error); return []; }
        return data || [];
    },

    async markConversationAsRead(userId, partnerId) {
        if (!sbClient) return;
        await sbClient.from('messages')
            .update({ read: true })
            .eq('from_id', partnerId)
            .eq('to_id', userId)
            .eq('read', false);
    },

    async getUnreadCount(userId) {
        if (!sbClient) return 0;
        const { count, error } = await sbClient.from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('to_id', userId)
            .eq('read', false);
        if (error) return 0;
        return count || 0;
    },

    async getAllUsers() {
        if (!sbClient) return [];
        const { data } = await sbClient.from('profiles')
            .select('id, name, username, email')
            .order('name', { ascending: true });
        return data || [];
    },

    subscribeToMessages(userId, callback) {
        if (!sbClient) return null;
        return sbClient.channel('user-messages-' + userId)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: 'to_id=eq.' + userId
            }, function(payload) {
                callback(payload.new);
            })
            .subscribe();
    },

    // ==================== REALTIME ====================
    subscribeToRosaries(callback) {
        if (!sbClient) return;
        return sbClient.channel('rosaries-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rosaries' }, callback)
            .subscribe();
    },

    subscribeToCenaculo(cenaculoId, callback) {
        if (!sbClient) return;
        return sbClient.channel('cenaculo-' + cenaculoId)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cenaculo_members', filter: 'cenaculo_id=eq.' + cenaculoId }, callback)
            .subscribe();
    },

    // ==================== ROSARIO CONTINUO ====================
    async addContinuoSlot(date, hour, userName) {
        if (!sbClient) return;
        const { data, error } = await sbClient.from('continuo_slots').upsert({
            date: date,
            hour: hour,
            user_name: userName
        }, { onConflict: 'date,hour,user_name' }).select();
        if (error) {
            console.error('❌ Error guardando turno:', error.message);
        } else {
            console.log('✅ Turno guardado en Supabase:', date, hour + ':00', userName);
        }
        return data;
    },

    async removeContinuoSlot(date, hour, userName) {
        if (!sbClient) return;
        const { error } = await sbClient.from('continuo_slots')
            .delete()
            .eq('date', date)
            .eq('hour', hour)
            .eq('user_name', userName);
        if (error) {
            console.error('❌ Error eliminando turno:', error.message);
        } else {
            console.log('✅ Turno eliminado de Supabase');
        }
    },

    async getContinuoSlots(date) {
        if (!sbClient) return [];
        const { data, error } = await sbClient.from('continuo_slots')
            .select('*')
            .eq('date', date)
            .order('hour', { ascending: true });
        if (error) console.error('Error obteniendo turnos:', error);
        return data || [];
    }
};

// === LOCAL STORAGE FALLBACK ===
function saveLocal(key, item) {
    try {
        const items = JSON.parse(localStorage.getItem('redmaria_' + key) || '[]');
        items.push(item);
        localStorage.setItem('redmaria_' + key, JSON.stringify(items));
    } catch(e) {}
}

function getLocal(key) {
    try { return JSON.parse(localStorage.getItem('redmaria_' + key) || '[]'); } catch(e) { return []; }
}

// === CONNECTION STATUS ===
async function checkSupabaseConnection() {
    var status = document.getElementById('db-status');
    if (!sbClient) {
        console.log('⚠️ Supabase no disponible, usando localStorage');
        if (status) { status.textContent = 'Offline (Local)'; status.style.color = '#f0a500'; }
        return false;
    }
    try {
        const { data, error } = await sbClient.from('profiles').select('count', { count: 'exact', head: true });
        if (error) throw error;
        console.log('✅ Conectado a Supabase');
        if (status) { status.textContent = 'Conectado'; status.style.color = '#27ae60'; }
        return true;
    } catch(e) {
        console.log('❌ Error de conexión:', e.message);
        if (status) { status.textContent = 'Error: ' + e.message; status.style.color = '#e74c3c'; }
        return false;
    }
}

// Auto-check on load
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(checkSupabaseConnection, 1000);
});

// Ensure global access for inline onclick handlers
window.db = db;
window.sbClient = sbClient;
