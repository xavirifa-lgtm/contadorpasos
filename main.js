import { analyzeMeterPhoto } from './gemini.js';
// Chart is loaded via CDN in index.html

// App State
let state = JSON.parse(localStorage.getItem('meter_app_state')) || {
    onboarded: false,
    apiKey: '',
    allowedSteps: 0, // Total steps given for the season
    seasonLimit: 0,  // initialReading + allowedSteps
    initialPhoto: '', // Base64 of the first photo
    readings: [],    // { date, value, consumption }
};

let chart = null;

// DOM Elements
const views = document.querySelectorAll('.view');
const navBtns = document.querySelectorAll('.nav-btn');
const progressCircle = document.getElementById('progress-circle');
const remainingStepsEl = document.getElementById('remaining-steps');
const estimateDateEl = document.getElementById('estimate-date');
const weeklyAvgEl = document.getElementById('weekly-avg');
const monthlyAvgEl = document.getElementById('monthly-avg');
const alertsEl = document.getElementById('alerts');
const cameraModal = document.getElementById('camera-modal');
const cameraInput = document.getElementById('camera-input');
const processingState = document.getElementById('processing-state');
const modelStatusEl = document.getElementById('model-status');

// Settings Elements
const settingsApiKey = document.getElementById('settings-api-key');
const settingsSteps = document.getElementById('settings-steps');
const saveSettingsBtn = document.getElementById('save-settings');
const resetAppBtn = document.getElementById('reset-app');
const exportDataBtn = document.getElementById('export-data');
const importDataInput = document.getElementById('import-data');

// Init
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initApp();
});

function initApp() {
    if (!state.onboarded) {
        showView('onboarding');
    } else {
        showView('dashboard');
        updateDashboard();
    }

    // Setup Nav
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.id === 'nav-camera') {
                openCamera();
            } else {
                const viewId = btn.id.replace('nav-', '');
                showView(viewId === 'home' ? 'dashboard' : viewId);
                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
        });
    });

    // Onboarding
    document.getElementById('save-initial').addEventListener('click', () => {
        const steps = parseFloat(document.getElementById('initial-steps').value);
        if (steps > 0) {
            state.allowedSteps = steps;
            state.onboarded = true;
            state.apiKey = prompt("Introduce tu Gemini API Key (tier gratuito):") || '';
            saveState();
            showView('dashboard');
            updateDashboard();
        }
    });

    // Settings Actions
    saveSettingsBtn.addEventListener('click', () => {
        state.apiKey = settingsApiKey.value;
        state.allowedSteps = parseFloat(settingsSteps.value) || state.allowedSteps;
        // Re-calculate limit if there are readings
        if (state.readings.length > 0) {
            state.seasonLimit = state.readings[0].value + state.allowedSteps;
        }
        saveState();
        alert("Configuración guardada");
        showView('dashboard');
        updateDashboard();
    });

    resetAppBtn.addEventListener('click', () => {
        if (confirm("¿Estás seguro de que quieres borrar TODOS los datos? Esta acción no se puede deshacer.")) {
            localStorage.removeItem('meter_app_state');
            location.reload();
        }
    });

    // Export / Import
    exportDataBtn.addEventListener('click', () => {
        const dataStr = JSON.stringify(state, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `contador_pasos_backup_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
    });

    importDataInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedState = JSON.parse(event.target.result);
                if (importedState.onboarded !== undefined) {
                    state = importedState;
                    saveState();
                    alert("Datos importados correctamente");
                    location.reload();
                } else {
                    throw new Error("Formato de backup inválido");
                }
            } catch (err) {
                alert("Error al importar: " + err.message);
            }
        };
        reader.readAsText(file);
    });

    // Camera Handling
    cameraInput.addEventListener('change', handlePhotoUpload);
    document.querySelector('.close-btn').addEventListener('click', () => cameraModal.classList.remove('active'));
}

function showView(id) {
    views.forEach(v => v.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
        // Sync settings inputs when entering settings view
        if (id === 'settings') {
            settingsApiKey.value = state.apiKey;
            settingsSteps.value = state.allowedSteps;
        }
    }
}

function openCamera() {
    cameraModal.classList.add('active');
    processingState.classList.add('hidden');
}

async function handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    processingState.classList.remove('hidden');

    try {
        const compressedBase64 = await compressImage(file);
        const result = await analyzeMeterPhoto(compressedBase64, state.apiKey, (status) => {
            modelStatusEl.textContent = status;
        });

        addReading(result.reading, compressedBase64);
        cameraModal.classList.remove('active');
    } catch (err) {
        alert("Error: " + err.message);
        processingState.classList.add('hidden');
    }
}

async function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 1024;
                const MAX_HEIGHT = 1024;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Export as JPEG with 0.8 quality
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                resolve(dataUrl.split(',')[1]);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

function addReading(value, photoBase64) {
    const now = new Date().toISOString();
    let consumption = 0;

    if (state.readings.length === 0) {
        // First reading of the season
        state.seasonLimit = value + state.allowedSteps;
        state.initialPhoto = photoBase64; // Save the first photo
        consumption = 0; // First reading is the baseline
    } else {
        const last = state.readings[state.readings.length - 1];
        consumption = value - last.value;
    }

    state.readings.push({ date: now, value, consumption });

    saveState();
    updateDashboard();
}

function updateDashboard() {
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

    if (state.readings.length === 0) {
        remainingStepsEl.textContent = state.allowedSteps;
        progressCircle.style.strokeDashoffset = 283;
        return;
    }

    const latest = state.readings[state.readings.length - 1].value;
    const currentSteps = Math.max(0, state.seasonLimit - latest);

    // Progress Circle
    const percent = Math.max(0, (currentSteps / state.allowedSteps) * 100);
    const offset = 283 - (283 * percent) / 100;
    progressCircle.style.strokeDashoffset = offset;
    remainingStepsEl.textContent = Math.round(currentSteps);

    // Stats
    calculateStats();
    renderChart();
    detectPeaks();
    renderInitialPhoto();
}

function renderInitialPhoto() {
    const section = document.getElementById('initial-photo-section');
    const img = document.getElementById('initial-photo-display');
    if (state.initialPhoto) {
        section.classList.remove('hidden');
        img.src = `data:image/jpeg;base64,${state.initialPhoto}`;
    } else {
        section.classList.add('hidden');
    }
}

function calculateStats() {
    if (state.readings.length < 2) return;

    const totalConsumed = state.readings.reduce((sum, r) => sum + r.consumption, 0);
    const firstDate = new Date(state.readings[0].date);
    const lastDate = new Date(state.readings[state.readings.length - 1].date);
    const diffDays = Math.max(1, (lastDate - firstDate) / (1000 * 60 * 60 * 24));

    const dailyAvg = totalConsumed / diffDays;
    weeklyAvgEl.textContent = (dailyAvg * 7).toFixed(1) + ' kW';
    monthlyAvgEl.textContent = (dailyAvg * 30).toFixed(1) + ' kW';

    // Estimation
    if (dailyAvg > 0) {
        const latest = state.readings[state.readings.length - 1].value;
        const currentSteps = state.seasonLimit - latest;
        const daysLeft = currentSteps / dailyAvg;
        const estDate = new Date();
        estDate.setDate(estDate.getDate() + daysLeft);
        estimateDateEl.textContent = estDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    } else {
        estimateDateEl.textContent = "Sin datos suf.";
    }
}

function detectPeaks() {
    alertsEl.innerHTML = '';
    if (state.readings.length < 3) return;

    // Average of previous consumptions
    const consumptions = state.readings.map(r => r.consumption);
    const recent = consumptions[consumptions.length - 1];
    const others = consumptions.slice(0, -1);
    const avg = others.reduce((a, b) => a + b, 0) / others.length;

    if (recent > avg * 1.5) {
        const alert = document.createElement('div');
        alert.className = 'stat-item';
        alert.style.borderColor = 'var(--danger)';
        alert.innerHTML = `
      <span class="stat-label" style="color:var(--danger)">Pico Inusual Detectado</span>
      <span class="stat-value" style="color:var(--text-primary)">+${((recent / avg - 1) * 100).toFixed(0)}% consumo extra</span>
      <p style="font-size:0.75rem; color:var(--text-secondary)">Lectura de hoy superior a la media.</p>
    `;
        alertsEl.appendChild(alert);
    }
}

function renderChart() {
    const ctx = document.getElementById('consumptionChart').getContext('2d');

    if (chart) chart.destroy();

    const labels = state.readings.slice(-7).map(r => new Date(r.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }));
    const data = state.readings.slice(-7).map(r => r.consumption);

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Consumo (kW)',
                data: data,
                borderColor: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.2)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#38bdf8'
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

function saveState() {
    localStorage.setItem('meter_app_state', JSON.stringify(state));
}
