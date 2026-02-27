// ==================== UTILITY MODULE ====================
const Utility = {
    generateUniqueId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
        
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    degreesToRadians(degrees) {
        return degrees * (Math.PI / 180);
    }
};

// ==================== STORAGE MODULE ====================
const Storage = {
    STORAGE_KEYS: {
        ALERTS: 'safesphere_alerts',
        USER_ZONES: 'safesphere_user_zones'
    },

    initializeStorage() {
        try {
            if (!localStorage.getItem(this.STORAGE_KEYS.ALERTS)) {
                localStorage.setItem(this.STORAGE_KEYS.ALERTS, JSON.stringify([]));
            }
            if (!localStorage.getItem(this.STORAGE_KEYS.USER_ZONES)) {
                localStorage.setItem(this.STORAGE_KEYS.USER_ZONES, JSON.stringify([]));
            }
        } catch (error) {
            console.error('Storage initialization error:', error);
        }
    },

    getAlerts() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEYS.ALERTS);
            if (!data) return [];
            return JSON.parse(data);
        } catch (error) {
            console.error('Error reading alerts:', error);
            return [];
        }
    },

    saveAlert(alertObject) {
        try {
            const alerts = this.getAlerts();
            
            const isDuplicate = alerts.some(a => 
                a.timestamp === alertObject.timestamp && 
                Math.abs(a.latitude - alertObject.latitude) < 0.001 && 
                Math.abs(a.longitude - alertObject.longitude) < 0.001
            );
            
            if (isDuplicate) {
                return { success: false, error: 'Duplicate alert detected nearby' };
            }
            
            alerts.push(alertObject);
            localStorage.setItem(this.STORAGE_KEYS.ALERTS, JSON.stringify(alerts));
            return { success: true };
        } catch (error) {
            console.error('Error saving alert:', error);
            return { success: false, error: 'Storage failed' };
        }
    },

    deleteAlert(alertId) {
        try {
            let alerts = this.getAlerts();
            alerts = alerts.filter(a => a.id !== alertId);
            localStorage.setItem(this.STORAGE_KEYS.ALERTS, JSON.stringify(alerts));
            return { success: true };
        } catch (error) {
            console.error('Error deleting alert:', error);
            return { success: false, error: 'Delete failed' };
        }
    },

    clearAlerts() {
        try {
            localStorage.setItem(this.STORAGE_KEYS.ALERTS, JSON.stringify([]));
            return { success: true };
        } catch (error) {
            return { success: false, error: 'Clear failed' };
        }
    }
};

// ==================== GPS MODULE ====================
const GPS = {
    getCurrentLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('GPS not supported on this device'));
                return;
            }

            const options = {
                enableHighAccuracy: true,
                timeout: 30000,
                maximumAge: 0
            };

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy
                    });
                },
                (error) => {
                    let errorMessage;
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            errorMessage = 'Location permission denied';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMessage = 'Location unavailable';
                            break;
                        case error.TIMEOUT:
                            errorMessage = 'Location request timed out';
                            break;
                        default:
                            errorMessage = 'Unable to get location';
                    }
                    reject(new Error(errorMessage));
                },
                options
            );
        });
    }
};

// ==================== SAFE ZONE MODULE ====================
const SafeZone = {
    defaultZones: [
        { name: 'Emergency Shelter - USA', latitude: 40.7128, longitude: -74.0060, type: 'Government' },
        { name: 'Emergency Shelter - UK', latitude: 51.5074, longitude: -0.1278, type: 'Community' },
        { name: 'Emergency Shelter - Japan', latitude: 35.6762, longitude: 139.6503, type: 'Medical' },
        { name: 'Emergency Shelter - Australia', latitude: -33.8688, longitude: 151.2093, type: 'Emergency' },
        { name: 'Emergency Shelter - Germany', latitude: 52.5200, longitude: 13.4050, type: 'Government' }
    ],
    
    cachedZones: [],
    lastFetch: null,

    async fetchSheltersFromOSM(lat, lon, radiusKm = 25) {
        const overpassUrl = 'https://overpass-api.de/api/interpreter';
        
        const query = `
            [out:json][timeout:25];
            (
              node["amenity"="shelter"](around:${radiusKm * 1000},${lat},${lon});
              way["amenity"="shelter"](around:${radiusKm * 1000},${lat},${lon});
              node["emergency"="assembly_point"](around:${radiusKm * 1000},${lat},${lon});
              way["emergency"="assembly_point"](around:${radiusKm * 1000},${lat},${lon});
              node["social_facility"="shelter"](around:${radiusKm * 1000},${lat},${lon});
              way["social_facility"="shelter"](around:${radiusKm * 1000},${lat},${lon});
              node["emergency_shelter"="yes"](around:${radiusKm * 1000},${lat},${lon});
            );
            out center;
        `;

        try {
            const response = await fetch(overpassUrl, {
                method: 'POST',
                body: query
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch shelters');
            }
            
            const data = await response.json();
            return this.processOSMData(data, lat, lon);
        } catch (error) {
            console.error('OSM Fetch Error:', error);
            return null;
        }
    },

    processOSMData(data, userLat, userLon) {
        if (!data.elements || data.elements.length === 0) {
            return [];
        }

        return data.elements.map(element => {
            const lat = element.lat || (element.center && element.center.lat);
            const lon = element.lon || (element.center && element.center.lon);
            
            const tags = element.tags || {};
            const name = tags.name || tags['name:en'] || 'Emergency Shelter';
            const type = this.getShelterType(tags);
            
            return {
                name: name,
                latitude: lat,
                longitude: lon,
                type: type,
                distance: this.calculateDistance(userLat, userLon, lat, lon),
                source: 'OpenStreetMap'
            };
        }).filter(z => z.latitude && z.longitude)
          .sort((a, b) => a.distance - b.distance);
    },

    getShelterType(tags) {
        if (tags.shelter_type) {
            const typeMap = {
                'homeless_shelter': 'Homeless Shelter',
                'emergency_shelter': 'Emergency Shelter',
                'weather_shelter': 'Weather Shelter',
                'public_transport': 'Transport Shelter',
                'assembly_point': 'Assembly Point'
            };
            return typeMap[tags.shelter_type] || tags.shelter_type;
        }
        if (tags.emergency) return 'Emergency Point';
        if (tags.social_facility) return 'Social Services';
        return 'Emergency Shelter';
    },

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = Utility.degreesToRadians(lat2 - lat1);
        const dLon = Utility.degreesToRadians(lon2 - lon1);
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(Utility.degreesToRadians(lat1)) * Math.cos(Utility.degreesToRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    },

    async findNearestSafeZone(userLat, userLon, useOnline = true) {
        if (useOnline) {
            const onlineZones = await this.fetchSheltersFromOSM(userLat, userLon, 25);
            if (onlineZones && onlineZones.length > 0) {
                this.cachedZones = onlineZones;
                this.lastFetch = Date.now();
                return onlineZones.slice(0, 10);
            }
        }
        
        const zonesWithDistance = this.defaultZones.map(zone => ({
            ...zone,
            distance: this.calculateDistance(userLat, userLon, zone.latitude, zone.longitude)
        }));
        
        return zonesWithDistance.sort((a, b) => a.distance - b.distance).slice(0, 5);
    },

    getAllZones() {
        return this.defaultZones;
    }
};

// ==================== ALERT MANAGEMENT MODULE ====================
const AlertManager = {
    currentLocation: null,

    validateForm() {
        const disasterType = document.getElementById('disasterType').value;
        const latitude = document.getElementById('latitude').value;
        const longitude = document.getElementById('longitude').value;
        
        const isValid = disasterType && latitude && longitude;
        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn) {
            submitBtn.disabled = !isValid;
        }
        return isValid;
    },

    async getLocation() {
        const btn = document.getElementById('getLocationBtn');
        const status = document.getElementById('gpsStatus');
        const latInput = document.getElementById('latitude');
        const lonInput = document.getElementById('longitude');
        
        if (!btn || !status) return;
        
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Getting location...';
        status.textContent = 'Requesting location...';
        status.className = 'gps-status loading';

        try {
            const location = await GPS.getCurrentLocation();
            this.currentLocation = location;
            latInput.value = location.latitude.toFixed(6);
            lonInput.value = location.longitude.toFixed(6);
            status.innerHTML = '✓ Location detected';
            status.className = 'gps-status success';
            this.showNotification('Location found!', 'success');
        } catch (error) {
            status.innerHTML = '✗ ' + error.message;
            status.className = 'gps-status error';
            this.currentLocation = null;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '📍 Get Current Location';
            this.validateForm();
        }
    },

    async submitAlert() {
        if (!this.validateForm()) {
            this.showNotification('Please fill all required fields', 'error');
            return;
        }

        const disasterType = document.getElementById('disasterType').value;
        const description = document.getElementById('description').value;
        const latitude = parseFloat(document.getElementById('latitude').value);
        const longitude = parseFloat(document.getElementById('longitude').value);

        const alertObject = {
            id: Utility.generateUniqueId(),
            type: disasterType,
            description: description,
            latitude: latitude,
            longitude: longitude,
            timestamp: Date.now()
        };

        const result = Storage.saveAlert(alertObject);

        if (result.success) {
            this.showNotification('Disaster reported successfully!', 'success');
            this.resetForm();
            this.loadAlerts();
            this.updateStats();
        } else {
            this.showNotification(result.error || 'Failed to save alert', 'error');
        }
    },

    resetForm() {
        document.getElementById('disasterType').value = '';
        document.getElementById('description').value = '';
        document.getElementById('latitude').value = '';
        document.getElementById('longitude').value = '';
        
        const status = document.getElementById('gpsStatus');
        if (status) {
            status.textContent = '';
            status.className = 'gps-status';
        }
        
        const charCount = document.getElementById('charCount');
        if (charCount) charCount.textContent = '0';
        
        this.currentLocation = null;
        this.validateForm();
    },

    loadAlerts() {
        const alerts = Storage.getAlerts();
        const container = document.getElementById('alertsList');
        
        if (!container) return;

        if (alerts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">✓</div>
                    <h3>No Active Alerts</h3>
                    <p>Stay safe! Report any disasters you see.</p>
                </div>
            `;
            return;
        }

        const sortedAlerts = [...alerts].sort((a, b) => b.timestamp - a.timestamp);
        
        const disasterIcons = {
            flood: '🌊',
            earthquake: '🏚️',
            fire: '🔥',
            storm: '⛈️',
            other: '⚠️'
        };
        
        container.innerHTML = sortedAlerts.map(alert => `
            <div class="alert-item ${alert.type}">
                <div class="alert-header">
                    <span class="alert-type">
                        ${disasterIcons[alert.type] || '⚠️'} ${alert.type}
                    </span>
                    <span class="alert-timestamp">${Utility.formatTimestamp(alert.timestamp)}</span>
                </div>
                ${alert.description ? `<p class="alert-description">${alert.description}</p>` : ''}
                <p class="alert-location">📍 ${alert.latitude.toFixed(4)}, ${alert.longitude.toFixed(4)}</p>
            </div>
        `).join('');
    },

    deleteAlert(alertId) {
        if (!confirm('Are you sure you want to delete this alert?')) return;
        
        const result = Storage.deleteAlert(alertId);
        if (result.success) {
            this.showNotification('Alert deleted', 'success');
            this.loadAlerts();
            this.updateStats();
        } else {
            this.showNotification('Failed to delete alert', 'error');
        }
    },

    updateStats() {
        const alerts = Storage.getAlerts();
        const alertCount = document.getElementById('alertCount');
        const safeZoneCount = document.getElementById('safeZoneCount');
        
        if (alertCount) alertCount.textContent = alerts.length;
        if (safeZoneCount) {
            const cached = SafeZone.cachedZones.length;
            safeZoneCount.textContent = cached > 0 ? cached : SafeZone.getAllZones().length;
        }
    },

    showNotification(message, type = 'info') {
        const existing = document.querySelector('.notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => notification.remove(), 3000);
    }
};

// ==================== MAP MODULE ====================
let map = null;
let userMarker = null;
let alertMarkers = [];
let safeZoneMarkers = [];
let selectedLocationMarker = null;

function initMap() {
    if (map) {
        map.remove();
        map = null;
    }

    map = L.map('map').setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(map);

    map.on('click', function(e) {
        if (selectedLocationMarker) {
            map.removeLayer(selectedLocationMarker);
        }
        selectedLocationMarker = L.marker(e.latlng, { 
            icon: L.divIcon({
                className: 'selected-marker',
                html: '<div style="background:#1a365d;width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(map);
        
        selectedLocationMarker.bindPopup(`
            <div style="text-align:center;">
                <b>Selected Location</b><br>
                <button onclick="useSelectedLocation()" style="background:#1a365d;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;margin-top:5px;">Report Here</button>
            </div>
        `).openPopup();
    });

    showMapMarkers();
    setTimeout(loadUserLocationOnMap, 500);
}

function useSelectedLocation() {
    if (selectedLocationMarker) {
        const latlng = selectedLocationMarker.getLatLng();
        document.getElementById('latitude').value = latlng.lat.toFixed(6);
        document.getElementById('longitude').value = latlng.lng.toFixed(6);
        AlertManager.validateForm();
        navigateTo('report');
    }
}

function loadUserLocationOnMap() {
    if (!map) return;
    
    GPS.getCurrentLocation()
        .then(loc => {
            if (userMarker) map.removeLayer(userMarker);
            
            userMarker = L.circleMarker([loc.latitude, loc.longitude], {
                radius: 12,
                fillColor: '#1a365d',
                color: '#fff',
                weight: 3,
                fillOpacity: 0.9
            }).addTo(map);
            
            userMarker.bindPopup(`<b>📍 You are here</b><br>Accuracy: ±${Math.round(loc.accuracy)}m`).openPopup();
            map.setView([loc.latitude, loc.longitude], 14);
        })
        .catch(err => {
            console.log('Location not available:', err.message);
        });
}

function refreshLocation() {
    if (!map) {
        initMap();
        return;
    }
    
    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
    
    loadUserLocationOnMap();
}

function showMapMarkers() {
    alertMarkers.forEach(m => map.removeLayer(m));
    safeZoneMarkers.forEach(m => map.removeLayer(m));
    alertMarkers = [];
    safeZoneMarkers = [];

    const alerts = Storage.getAlerts();

    alerts.forEach(alert => {
        const marker = L.circleMarker([alert.latitude, alert.longitude], {
            radius: 10,
            fillColor: '#c53030',
            color: '#fff',
            weight: 2,
            fillOpacity: 0.8
        }).addTo(map);
        
        marker.bindPopup(`<b>⚠️ ${alert.type.toUpperCase()}</b><br>${alert.description || 'No description'}<br><small>${Utility.formatTimestamp(alert.timestamp)}</small>`);
        alertMarkers.push(marker);
    });

    const zones = SafeZone.cachedZones.length > 0 ? SafeZone.cachedZones : SafeZone.getAllZones();
    
    zones.forEach(zone => {
        const marker = L.circleMarker([zone.latitude, zone.longitude], {
            radius: 10,
            fillColor: '#276749',
            color: '#fff',
            weight: 2,
            fillOpacity: 0.8
        }).addTo(map);
        
        marker.bindPopup(`<b>🏠 ${zone.name}</b><br>${zone.type}${zone.distance ? '<br>' + zone.distance.toFixed(1) + ' km' : ''}`);
        safeZoneMarkers.push(marker);
    });
}

async function reportFromMap() {
    try {
        const location = await GPS.getCurrentLocation();
        document.getElementById('latitude').value = location.latitude.toFixed(6);
        document.getElementById('longitude').value = location.longitude.toFixed(6);
        AlertManager.validateForm();
        navigateTo('report');
    } catch (error) {
        AlertManager.showNotification('Could not get location: ' + error.message, 'error');
    }
}

// ==================== SAFE ZONE FINDER ====================
async function findSafeZones() {
    const container = document.getElementById('safeZonesList');
    
    container.innerHTML = `
        <div class="loading-container">
            <div class="spinner"></div>
            <p class="text-muted mt-2">Searching OpenStreetMap for shelters...</p>
        </div>
    `;

    try {
        const location = await GPS.getCurrentLocation();
        
        container.innerHTML = `
            <div class="loading-container">
                <div class="spinner"></div>
                <p class="text-muted mt-2">Finding shelters near you...</p>
            </div>
        `;
        
        const zones = await SafeZone.findNearestSafeZone(location.latitude, location.longitude, true);
        
        if (zones.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🏠</div>
                    <h3>No Shelters Found</h3>
                    <p>No emergency shelters found in your area. Try a wider search.</p>
                    <button class="btn btn-primary mt-2" onclick="findSafeZones()">
                        🔄 Try Again
                    </button>
                </div>
            `;
            return;
        }
        
        container.innerHTML = zones.map((zone, index) => `
            <div class="safe-zone-item ${index === 0 ? 'nearest' : ''}">
                <div class="safe-zone-header">
                    <div>
                        <div class="safe-zone-name">🏠 ${zone.name}</div>
                        <div class="safe-zone-type">${zone.type} ${zone.source ? '• ' + zone.source : ''}</div>
                    </div>
                    <div class="safe-zone-distance">
                        <div class="distance-value">${zone.distance.toFixed(2)}</div>
                        <div class="distance-label">km away</div>
                    </div>
                </div>
                <p class="alert-location mt-1">📍 ${zone.latitude.toFixed(4)}, ${zone.longitude.toFixed(4)}</p>
                ${index === 0 ? '<span class="nearest-badge">★ Nearest</span>' : ''}
            </div>
        `).join('');
        
        AlertManager.showNotification(`Found ${zones.length} shelters nearby!`, 'success');
    } catch (error) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📍</div>
                <h3>Location Required</h3>
                <p>${error.message}</p>
                <button class="btn btn-primary mt-2" onclick="findSafeZones()">
                    🔄 Try Again
                </button>
            </div>
        `;
    }
}

// ==================== NAVIGATION MODULE ====================
const Navigation = {
    currentScreen: 'home',
    history: ['home'],

    navigate(screenName) {
        const screens = ['home', 'report', 'alerts', 'safezones', 'map'];
        
        if (!screens.includes(screenName)) {
            console.error('Invalid screen:', screenName);
            return;
        }

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenName + 'Screen').classList.add('active');

        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector(`.nav-item[data-screen="${screenName}"]`)?.classList.add('active');

        this.currentScreen = screenName;
        this.history.push(screenName);

        if (screenName === 'alerts') {
            AlertManager.loadAlerts();
        } else if (screenName === 'safezones') {
            document.getElementById('safeZonesList').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🏠</div>
                    <h3>Find Safe Zones</h3>
                    <p>Click the button below to find the nearest emergency shelters.</p>
                </div>
            `;
        } else if (screenName === 'map') {
            setTimeout(async () => {
                if (!map) initMap();
                else {
                    try {
                        const loc = await GPS.getCurrentLocation();
                        await SafeZone.findNearestSafeZone(loc.latitude, loc.longitude, true);
                    } catch(e) {}
                    showMapMarkers();
                    loadUserLocationOnMap();
                }
            }, 100);
        }

        window.scrollTo(0, 0);
    },

    goBack() {
        if (this.history.length > 1) {
            this.history.pop();
            const prevScreen = this.history[this.history.length - 1];
            this.navigate(prevScreen);
        }
    }
};

function navigateTo(screen) {
    Navigation.navigate(screen);
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    Storage.initializeStorage();
    
    AlertManager.updateStats();

    const disasterType = document.getElementById('disasterType');
    if (disasterType) {
        disasterType.addEventListener('change', () => AlertManager.validateForm());
    }
    
    const description = document.getElementById('description');
    if (description) {
        description.addEventListener('input', (e) => {
            const charCount = document.getElementById('charCount');
            if (charCount) charCount.textContent = e.target.value.length;
            AlertManager.validateForm();
        });
    }

    setTimeout(() => {
        const splash = document.getElementById('splashScreen');
        if (splash) splash.classList.add('hidden');
    }, 2000);

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then((registration) => {
                    console.log('SW registered:', registration.scope);
                })
                .catch((error) => {
                    console.log('SW registration failed:', error);
                });
        });
    }
});
