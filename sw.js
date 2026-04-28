// === Red Maria Service Worker v6 ===
// Handles background notifications + cache busting

const CACHE_NAME = 'redmaria-v12';

// Install event - force immediate activation
self.addEventListener('install', function(event) {
    console.log('[SW] Installing v6...');
    self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', function(event) {
    console.log('[SW] Activated v6');
    event.waitUntil(
        caches.keys().then(function(names) {
            return Promise.all(
                names.filter(function(n) { return n !== CACHE_NAME; })
                    .map(function(n) { console.log('[SW] Deleting old cache:', n); return caches.delete(n); })
            );
        }).then(function() { return self.clients.claim(); })
    );
});

// Network-first fetch: always get fresh files, fallback to cache only offline
self.addEventListener('fetch', function(event) {
    event.respondWith(
        fetch(event.request).then(function(response) {
            // Cache a copy for offline fallback
            if (response.ok && event.request.method === 'GET') {
                var clone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
            }
            return response;
        }).catch(function() {
            return caches.match(event.request);
        })
    );
});

// Vibration pattern: mimics a phone ring (long vibrations with pauses)
var RING_VIBRATE = [
    500, 200, 500, 200, 500, 400,  // ring ring ring - pause
    500, 200, 500, 200, 500, 400,  // ring ring ring - pause
    500, 200, 500, 200, 500, 400,  // ring ring ring - pause
    500, 200, 500, 200, 500, 400,  // ring ring ring - pause
    500, 200, 500, 200, 500        // ring ring ring
];

// Track active call notifications for re-ringing
var _ringInterval = null;
var _ringData = null;

// Listen for messages from the main app
self.addEventListener('message', function(event) {
    if (!event.data) return;

    if (event.data.type === 'INCOMING_CALL') {
        _ringData = event.data;
        _showCallNotification(event.data, true);

        // Re-vibrate every 5 seconds by updating the notification (keeps the phone awake)
        clearInterval(_ringInterval);
        var ringCount = 0;
        _ringInterval = setInterval(function() {
            ringCount++;
            if (ringCount > 12) { // Stop after ~60 seconds
                clearInterval(_ringInterval);
                _ringInterval = null;
                return;
            }
            _showCallNotification(_ringData, true);
        }, 5000);
    }

    if (event.data.type === 'CANCEL_CALL' || event.data.type === 'CALL_ANSWERED') {
        // Stop ringing
        clearInterval(_ringInterval);
        _ringInterval = null;
        _ringData = null;
        // Close all call notifications
        self.registration.getNotifications().then(function(notifs) {
            notifs.forEach(function(n) {
                if (n.tag && n.tag.indexOf('incoming-call') !== -1) n.close();
            });
        });
    }
});

function _showCallNotification(data, isUrgent) {
    self.registration.showNotification('📞 Llamada entrante', {
        body: (data.callerName || 'Alguien') + ' te está llamando desde ' + (data.cenaculoName || 'Red Maria'),
        icon: 'assets/mary_avatar.png',
        badge: 'assets/mary_avatar.png',
        image: 'assets/mary_avatar.png',
        tag: 'incoming-call-' + (data.cenaculoId || 'unknown'),
        renotify: true,  // Re-alert even if same tag (vibrate again!)
        requireInteraction: true,  // Don't auto-dismiss
        silent: false,  // Use system sound
        urgency: 'high',
        vibrate: RING_VIBRATE,
        actions: [
            { action: 'accept', title: '✅ Aceptar' },
            { action: 'decline', title: '❌ Rechazar' }
        ],
        data: {
            cenaculoId: data.cenaculoId,
            callerName: data.callerName,
            roomName: data.roomName,
            url: self.registration.scope
        }
    }).catch(function(err) {
        console.warn('[SW] Notification error:', err);
    });
}

// Handle notification clicks
self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    // Stop ringing
    clearInterval(_ringInterval);
    _ringInterval = null;
    _ringData = null;

    var action = event.action;
    var data = event.notification.data || {};

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            // Find existing window
            for (var i = 0; i < clientList.length; i++) {
                var client = clientList[i];
                if (client.url.indexOf('red-maria') !== -1 || client.url.indexOf('index.html') !== -1 || client.url.indexOf('localhost') !== -1) {
                    // Focus the existing window and send message
                    return client.focus().then(function(focusedClient) {
                        focusedClient.postMessage({
                            type: action === 'decline' ? 'DECLINE_CALL' : 'ACCEPT_CALL',
                            cenaculoId: data.cenaculoId,
                            callerName: data.callerName,
                            roomName: data.roomName
                        });
                    });
                }
            }
            // No window found, open the app
            if (self.clients.openWindow) {
                return self.clients.openWindow(data.url || './');
            }
        })
    );
});

// Handle notification close (dismissed without action)
self.addEventListener('notificationclose', function(event) {
    // Stop ringing
    clearInterval(_ringInterval);
    _ringInterval = null;

    var data = event.notification.data || {};
    self.clients.matchAll({ type: 'window' }).then(function(clientList) {
        clientList.forEach(function(client) {
            client.postMessage({
                type: 'DECLINE_CALL',
                cenaculoId: data.cenaculoId
            });
        });
    });
});
