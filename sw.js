// === Red Maria Service Worker ===
// Handles background notifications for incoming video calls

const CACHE_NAME = 'redmaria-v1';

// Install event - cache essential files
self.addEventListener('install', function(event) {
    console.log('[SW] Installing...');
    self.skipWaiting();
});

// Activate event
self.addEventListener('activate', function(event) {
    console.log('[SW] Activated');
    event.waitUntil(self.clients.claim());
});

// Listen for messages from the main app
self.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'INCOMING_CALL') {
        var data = event.data;
        // Show notification
        self.registration.showNotification('📞 Llamada entrante - Red Maria', {
            body: data.callerName + ' te está llamando desde ' + (data.cenaculoName || 'un cenáculo'),
            icon: 'assets/mary_avatar.png',
            badge: 'assets/mary_avatar.png',
            tag: 'incoming-call-' + data.cenaculoId,
            requireInteraction: true,
            vibrate: [200, 100, 200, 100, 200],
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
});

// Handle notification clicks
self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    var action = event.action;
    var data = event.notification.data || {};

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            // Find existing window
            for (var i = 0; i < clientList.length; i++) {
                var client = clientList[i];
                if (client.url.indexOf('red-maria') !== -1 || client.url.indexOf('index.html') !== -1 || client.url.indexOf('localhost') !== -1) {
                    // Focus the existing window and send message
                    client.focus();
                    client.postMessage({
                        type: action === 'decline' ? 'DECLINE_CALL' : 'ACCEPT_CALL',
                        cenaculoId: data.cenaculoId,
                        callerName: data.callerName,
                        roomName: data.roomName
                    });
                    return;
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
