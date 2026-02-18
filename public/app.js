// ============================================================
// DHC Order Scraper — Frontend Application
// ============================================================

const API_BASE = '';

// State
let currentOrders = [];
let caseInfo = '';

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    createParticles();
    loadCaseTypes();

    document.getElementById('searchForm').addEventListener('submit', handleSearch);
});

// Create floating particles
function createParticles() {
    const container = document.getElementById('particles');
    const count = 25;

    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.classList.add('particle');
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDuration = (8 + Math.random() * 15) + 's';
        particle.style.animationDelay = Math.random() * 10 + 's';
        particle.style.width = (2 + Math.random() * 3) + 'px';
        particle.style.height = particle.style.width;

        // Random colors
        const colors = [
            'rgba(139, 92, 246, 0.5)',
            'rgba(6, 182, 212, 0.4)',
            'rgba(16, 185, 129, 0.4)',
            'rgba(167, 139, 250, 0.4)',
        ];
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];

        container.appendChild(particle);
    }
}

// ============================================================
// Load Case Types from DHC
// ============================================================
async function loadCaseTypes() {
    const caseTypeSelect = document.getElementById('caseType');
    const yearSelect = document.getElementById('year');

    try {
        const response = await fetch(`${API_BASE}/api/case-types`);
        const data = await response.json();

        if (data.success) {
            // Populate case types
            caseTypeSelect.innerHTML = '<option value="">Select Case Type</option>';
            data.caseTypes.forEach(ct => {
                const option = document.createElement('option');
                option.value = ct.value;
                option.textContent = ct.text || ct.value;
                caseTypeSelect.appendChild(option);
            });

            // Populate years
            yearSelect.innerHTML = '<option value="">Select Year</option>';
            data.years.forEach(y => {
                const option = document.createElement('option');
                option.value = y.value;
                option.textContent = y.text || y.value;
                yearSelect.appendChild(option);
            });

            console.log(`✅ Loaded ${data.caseTypes.length} case types and ${data.years.length} years`);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error('Failed to load case types:', error);
        caseTypeSelect.innerHTML = '<option value="">Failed to load — Retry</option>';
        yearSelect.innerHTML = '<option value="">Failed to load</option>';

        // Fallback: add common case types
        const commonTypes = [
            'BAIL APPLN.', 'CEAC', 'CM(M)', 'CO.PET.', 'CONT.CAS(C)',
            'CRL.A.', 'CRL.L.P.', 'CRL.M.C.', 'CRL.REV.P.', 'CS(COMM)',
            'CS(OS)', 'EFA(OS)', 'EX.P.', 'FAO', 'FAO(OS)',
            'I.A.', 'LPA', 'MAC.APP.', 'MAT.APP.(F.C.)', 'OMP (COMM.)',
            'OMP (ENF.)(COMM.)', 'RFA', 'RFA(OS)', 'RSA', 'SUIT(IPD)',
            'TEST.CAS.', 'W.P.(C)', 'W.P.(CRL.)',
        ];

        caseTypeSelect.innerHTML = '<option value="">Select Case Type</option>';
        commonTypes.forEach(ct => {
            const option = document.createElement('option');
            option.value = ct;
            option.textContent = ct;
            caseTypeSelect.appendChild(option);
        });

        // Fallback years
        yearSelect.innerHTML = '<option value="">Select Year</option>';
        const currentYear = new Date().getFullYear();
        for (let y = currentYear; y >= 1950; y--) {
            const option = document.createElement('option');
            option.value = y;
            option.textContent = y;
            yearSelect.appendChild(option);
        }
    }
}

// ============================================================
// Handle Search
// ============================================================
async function handleSearch(e) {
    e.preventDefault();

    const caseType = document.getElementById('caseType').value;
    const caseNumber = document.getElementById('caseNumber').value;
    const year = document.getElementById('year').value;

    if (!caseType || !caseNumber || !year) {
        showError('Please fill in all fields — Case Type, Case Number, and Year.');
        return;
    }

    showLoading('Searching Case...', `Looking up ${caseType} ${caseNumber}/${year}`);

    try {
        const response = await fetch(`${API_BASE}/api/search-case`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caseType, caseNumber, year }),
        });

        const data = await response.json();

        if (data.success && data.orders && data.orders.length > 0) {
            currentOrders = data.orders;
            caseInfo = `${caseType} ${caseNumber}/${year}`;
            showResults(data);
        } else {
            const errorMsg = data.error || 'No orders found for this case. Please verify the case details and try again.';
            showError(errorMsg);
        }
    } catch (error) {
        console.error('Search failed:', error);
        showError(`Connection error: ${error.message}. Please try again.`);
    }
}

// ============================================================
// Display Results
// ============================================================
function showResults(data) {
    hideAll();

    const section = document.getElementById('resultsSection');
    section.style.display = '';

    // Title
    document.getElementById('resultsCaseTitle').textContent = caseInfo;
    document.getElementById('resultsCount').textContent = `${data.totalOrders} order(s) found`;

    // Info bar
    const infoBar = document.getElementById('caseInfoBar');
    const caseDetails = data.caseDetails || {};
    infoBar.innerHTML = '';

    if (caseDetails.parties) {
        addInfoChip(infoBar, 'Parties', caseDetails.parties);
    }
    if (caseDetails.listingDate) {
        addInfoChip(infoBar, 'Listing', caseDetails.listingDate);
    }
    addInfoChip(infoBar, 'Orders', data.totalOrders);

    // Table
    const tbody = document.getElementById('ordersBody');
    tbody.innerHTML = '';

    data.orders.forEach((order, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="order-number">${order.sno || index + 1}</span></td>
            <td><span class="order-case">${order.caseNo || caseInfo}</span></td>
            <td><span class="order-date">${order.date || 'N/A'}</span></td>
            <td>
                <a href="${order.pdfUrl}" target="_blank" class="btn-view-pdf" title="View PDF">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    View
                </a>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Smooth scroll to results
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function addInfoChip(container, label, value) {
    const chip = document.createElement('span');
    chip.className = 'info-chip';
    chip.innerHTML = `${label}: <strong>${value}</strong>`;
    container.appendChild(chip);
}

// ============================================================
// Download and Merge
// ============================================================
async function downloadAndMerge() {
    if (currentOrders.length === 0) return;

    hideSection('resultsSection');
    showSection('downloadSection');

    const progressBar = document.getElementById('downloadProgressBar');
    const progressText = document.getElementById('downloadProgress');
    const logContainer = document.getElementById('downloadLog');

    logContainer.innerHTML = '';
    progressBar.style.width = '0%';
    progressText.textContent = `Starting download of ${currentOrders.length} orders...`;

    addLog(logContainer, `🚀 Starting download of ${currentOrders.length} orders...`, 'info');

    try {
        const response = await fetch(`${API_BASE}/api/download-and-merge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orders: currentOrders,
                caseInfo: caseInfo,
            }),
        });

        // Simulate progress since this is one request
        let progress = 0;
        const progressInterval = setInterval(() => {
            if (progress < 90) {
                progress += Math.random() * 8;
                if (progress > 90) progress = 90;
                progressBar.style.width = progress + '%';
                progressText.textContent = `Downloading and merging... ${Math.round(progress)}%`;
            }
        }, 500);

        const data = await response.json();

        clearInterval(progressInterval);
        progressBar.style.width = '100%';

        if (data.success) {
            // Log downloads
            data.downloadedFiles.forEach((file, i) => {
                const icon = file.mergeError ? '⚠️' : '✅';
                addLog(logContainer, `${icon} Order ${i + 1}: ${file.date} (${formatSize(file.size)}, ${file.pages} pages)`,
                    file.mergeError ? 'error' : 'success');
            });

            data.errors.forEach(err => {
                addLog(logContainer, `❌ Order ${err.index}: ${err.error}`, 'error');
            });

            addLog(logContainer, `\n📋 Merged PDF: ${data.mergedPages} total pages`, 'info');
            progressText.textContent = 'Download complete!';

            // Show merged section after a brief delay
            setTimeout(() => {
                showMergedResult(data);
            }, 800);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error('Download failed:', error);
        addLog(logContainer, `❌ Error: ${error.message}`, 'error');
        progressText.textContent = 'Download failed';
    }
}

function showMergedResult(data) {
    showSection('mergedSection');

    document.getElementById('mergedInfo').textContent =
        `${caseInfo} — All orders merged into a single PDF file`;

    const stats = document.getElementById('mergedStats');
    stats.innerHTML = `
        <div class="stat-item">
            <span class="stat-value">${data.totalDownloaded}</span>
            <span class="stat-label">Orders</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${data.mergedPages}</span>
            <span class="stat-label">Pages</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${formatSize(data.mergedSize)}</span>
            <span class="stat-label">File Size</span>
        </div>
    `;

    const downloadBtn = document.getElementById('downloadMergedBtn');
    downloadBtn.href = data.mergedFile;
    downloadBtn.download = `Merged_Order_File_${caseInfo.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    document.getElementById('mergedSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ============================================================
// UI Helpers
// ============================================================
function showLoading(title, desc) {
    hideAll();
    const section = document.getElementById('loadingSection');
    section.style.display = '';
    document.getElementById('loadingTitle').textContent = title;
    document.getElementById('loadingDesc').textContent = desc;

    // Animate progress bar
    const bar = document.getElementById('progressBar');
    bar.style.width = '0%';
    let progress = 0;
    const interval = setInterval(() => {
        if (progress < 85) {
            progress += Math.random() * 12;
            if (progress > 85) progress = 85;
            bar.style.width = progress + '%';
        }
    }, 300);

    section.dataset.interval = interval;
}

function showError(message) {
    hideAll();
    const section = document.getElementById('errorSection');
    section.style.display = '';
    document.getElementById('errorMessage').textContent = message;
}

function showSection(id) {
    document.getElementById(id).style.display = '';
}

function hideSection(id) {
    document.getElementById(id).style.display = 'none';
}

function hideAll() {
    // Clear any loading interval
    const loadingSection = document.getElementById('loadingSection');
    if (loadingSection.dataset.interval) {
        clearInterval(parseInt(loadingSection.dataset.interval));
    }

    document.getElementById('loadingSection').style.display = 'none';
    document.getElementById('errorSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('downloadSection').style.display = 'none';
    document.getElementById('mergedSection').style.display = 'none';
}

function resetSearch() {
    hideAll();
    document.getElementById('searchForm').reset();
    currentOrders = [];
    caseInfo = '';
    document.getElementById('search-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function addLog(container, message, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = message;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
