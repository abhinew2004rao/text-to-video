/**
 * Text-to-Video Studio — Frontend Client Application
 */

(function () {
  'use strict';

  // State
  let currentVideoData = null;
  let currentViewMode = 'clip'; // 'clip' or 'full'
  let libraryItems = [];
  let isGenerating = false;
  let selectedStylePrefix = 'cartoon video of';

  // Elements
  const promptInput = document.getElementById('promptInput');
  const promptCharCount = document.getElementById('promptCharCount');
  const styleChips = document.getElementById('styleChips');
  const clipDurationSlider = document.getElementById('clipDurationSlider');
  const durationValue = document.getElementById('durationValue');
  const openLocalToggle = document.getElementById('openLocalToggle');
  const btnGenerate = document.getElementById('btnGenerate');

  // Pipeline elements
  const pipelineTracker = document.getElementById('pipelineTracker');
  const pipelineSpinner = document.getElementById('pipelineSpinner');
  const pipelineStatusText = document.getElementById('pipelineStatusText');
  const pipelineLog = document.getElementById('pipelineLog');
  const steps = [
    document.getElementById('step1'),
    document.getElementById('step2'),
    document.getElementById('step3'),
    document.getElementById('step4'),
    document.getElementById('step5')
  ];

  // Video Stage Elements
  const playerPlaceholder = document.getElementById('playerPlaceholder');
  const activeVideoStage = document.getElementById('activeVideoStage');
  const mainVideoPlayer = document.getElementById('mainVideoPlayer');
  const versionTabs = document.getElementById('versionTabs');
  const tabClip = document.getElementById('tabClip');
  const tabFull = document.getElementById('tabFull');
  const playerDurationBadge = document.getElementById('playerDurationBadge');
  const stageVideoTitle = document.getElementById('stageVideoTitle');
  const stageYouTubeLink = document.getElementById('stageYouTubeLink');
  const tagVideoId = document.querySelector('#tagVideoId span');
  const tagDuration = document.querySelector('#tagDuration span');
  const tagFileSize = document.querySelector('#tagFileSize span');
  const btnDownload = document.getElementById('btnDownload');
  const btnOpenLocal = document.getElementById('btnOpenLocal');
  const btnCopyLink = document.getElementById('btnCopyLink');
  const btnLoadLatest = document.getElementById('btnLoadLatest');

  // Library Elements
  const libraryGrid = document.getElementById('libraryGrid');
  const librarySearchInput = document.getElementById('librarySearchInput');
  const btnRefreshLibrary = document.getElementById('btnRefreshLibrary');
  const libraryCountBadge = document.getElementById('libraryCountBadge');

  // Status Elements
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const storageText = document.getElementById('storageText');
  const toastContainer = document.getElementById('toastContainer');

  /* ============================================================
     NOTIFICATIONS / TOASTS
     ============================================================ */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 4000);
  }

  /* ============================================================
     INIT & EVENT LISTENERS
     ============================================================ */
  function init() {
    updateCharCount();
    checkSystemStatus();
    fetchLibrary(true);

    // Prompt input count
    promptInput.addEventListener('input', updateCharCount);

    // Ctrl + Enter to generate
    promptInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        startGeneration();
      }
    });

    // Style chips
    styleChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.style-chip');
      if (!chip) return;

      document.querySelectorAll('.style-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedStylePrefix = chip.dataset.style;
    });

    // Inspiration Pills
    document.querySelectorAll('.insp-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        promptInput.value = pill.dataset.prompt;
        updateCharCount();
        promptInput.focus();
      });
    });

    // Slider
    clipDurationSlider.addEventListener('input', () => {
      durationValue.textContent = `${clipDurationSlider.value}s`;
    });

    // Generate CTA
    btnGenerate.addEventListener('click', startGeneration);

    // Version Tabs
    tabClip.addEventListener('click', () => switchPlayerView('clip'));
    tabFull.addEventListener('click', () => switchPlayerView('full'));

    // Stage Action Buttons
    btnOpenLocal.addEventListener('click', () => {
      if (!currentVideoData) return;
      const filename = (currentViewMode === 'clip' && currentVideoData.is_clipped)
        ? currentVideoData.clip_filename
        : currentVideoData.video_filename;
      triggerOpenLocal(filename);
    });

    btnCopyLink.addEventListener('click', () => {
      if (!mainVideoPlayer.src) return;
      navigator.clipboard.writeText(mainVideoPlayer.src).then(() => {
        showToast('Stream URL copied to clipboard!', 'success');
      });
    });

    btnLoadLatest.addEventListener('click', () => {
      if (libraryItems.length > 0) {
        loadItemIntoStage(libraryItems[0]);
      }
    });

    // Library refresh & search
    btnRefreshLibrary.addEventListener('click', () => fetchLibrary(false));
    librarySearchInput.addEventListener('input', filterLibraryDisplay);
  }

  function updateCharCount() {
    const len = promptInput.value.length;
    promptCharCount.textContent = `${len} char${len === 1 ? '' : 's'}`;
  }

  /* ============================================================
     SYSTEM STATUS
     ============================================================ */
  async function checkSystemStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Status check failed');
      const data = await res.json();

      statusDot.style.backgroundColor = 'var(--accent-emerald)';
      statusDot.style.boxShadow = '0 0 10px var(--accent-emerald)';
      statusText.textContent = 'Server Online • Ready';

      storageText.textContent = `${data.total_files} file${data.total_files === 1 ? '' : 's'} (${data.total_storage_mb} MB)`;
    } catch (err) {
      statusDot.style.backgroundColor = 'var(--accent-crimson)';
      statusDot.style.boxShadow = '0 0 10px var(--accent-crimson)';
      statusText.textContent = 'Backend Offline';
    }
  }

  /* ============================================================
     PIPELINE ANIMATION CONTROLLER
     ============================================================ */
  function setPipelineStage(stageNumber, statusMsg, logMsg) {
    pipelineTracker.style.display = 'flex';
    pipelineStatusText.textContent = statusMsg;
    if (logMsg) {
      pipelineLog.textContent = logMsg;
    }

    steps.forEach((stepEl, idx) => {
      const stepIdx = idx + 1;
      stepEl.classList.remove('active', 'completed');

      if (stepIdx < stageNumber) {
        stepEl.classList.add('completed');
      } else if (stepIdx === stageNumber) {
        stepEl.classList.add('active');
      }
    });

    if (stageNumber >= 5) {
      pipelineSpinner.className = 'fa-solid fa-circle-check';
      pipelineSpinner.style.color = 'var(--accent-emerald)';
      steps.forEach(stepEl => {
        stepEl.classList.remove('active');
        stepEl.classList.add('completed');
      });
    } else {
      pipelineSpinner.className = 'fa-solid fa-spinner fa-spin';
      pipelineSpinner.style.color = 'var(--accent-cyan)';
    }
  }

  /* ============================================================
     VIDEO GENERATION FLOW
     ============================================================ */
  async function startGeneration() {
    if (isGenerating) return;

    const prompt = promptInput.value.trim();
    if (!prompt) {
      showToast('Please enter a prompt or scene description', 'error');
      promptInput.focus();
      return;
    }

    isGenerating = true;
    btnGenerate.disabled = true;
    setPipelineStage(1, 'Searching YouTube Data API...', `Searching YouTube for: "${prompt}"...`);

    const clipLength = parseInt(clipDurationSlider.value, 10) || 15;
    const openLocal = openLocalToggle.checked;

    // Use Server-Sent Events (SSE) for real-time live progression
    const queryParams = new URLSearchParams({
      prompt: prompt,
      style_prefix: selectedStylePrefix,
      clip_length: clipLength,
      open_local: openLocal
    });

    try {
      const eventSource = new EventSource(`/api/generate-stream?${queryParams.toString()}`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.status === 'error') {
            eventSource.close();
            handleGenerationError(data.message);
            return;
          }

          if (data.stage === 1) {
            setPipelineStage(1, 'Searching...', data.message);
          } else if (data.stage === 2) {
            setPipelineStage(2, 'Stream Located', data.message);
          } else if (data.stage === 3) {
            setPipelineStage(3, 'Downloading 360p...', data.message);
          } else if (data.stage === 4) {
            setPipelineStage(4, 'Cutting Clip with FFmpeg...', data.message);
          } else if (data.stage === 5 || data.status === 'complete') {
            eventSource.close();
            setPipelineStage(5, 'Completed!', 'Video ready to stream & download!');
            handleGenerationSuccess(data);
          }
        } catch (parseErr) {
          console.error('SSE JSON parse error:', parseErr);
        }
      };

      eventSource.onerror = (err) => {
        eventSource.close();
        console.warn('SSE disconnected or failed, falling back to POST API...', err);
        fallbackPostGeneration(prompt, selectedStylePrefix, clipLength, openLocal);
      };

    } catch (e) {
      fallbackPostGeneration(prompt, selectedStylePrefix, clipLength, openLocal);
    }
  }

  async function fallbackPostGeneration(prompt, stylePrefix, clipLength, openLocal) {
    try {
      setPipelineStage(2, 'Processing Pipeline...', 'Downloading and processing video...');

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          style_prefix: stylePrefix,
          clip_length: clipLength,
          open_local: openLocal
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Generation failed');
      }

      const data = await response.json();
      setPipelineStage(5, 'Completed!', 'Video ready to stream!');
      handleGenerationSuccess(data);

    } catch (err) {
      handleGenerationError(err.message);
    }
  }

  function handleGenerationSuccess(data) {
    isGenerating = false;
    btnGenerate.disabled = false;
    showToast('Video clip generated successfully!', 'success');

    currentVideoData = data;
    loadVideoDataToStage(data);
    fetchLibrary(false);
  }

  function handleGenerationError(errorMsg) {
    isGenerating = false;
    btnGenerate.disabled = false;
    pipelineTracker.style.display = 'none';
    showToast(`Error: ${errorMsg}`, 'error');
  }

  /* ============================================================
     STAGE & VIDEO PLAYER CONTROLLER
     ============================================================ */
  function loadVideoDataToStage(data) {
    currentVideoData = data;
    playerPlaceholder.style.display = 'none';
    activeVideoStage.style.display = 'block';

    const hasClip = data.is_clipped && data.clip_stream_url;
    versionTabs.style.display = hasClip ? 'flex' : 'none';

    // Default view: clip if available, otherwise full
    currentViewMode = hasClip ? 'clip' : 'full';
    updatePlayerSource();

    // Populate info
    stageVideoTitle.textContent = data.query || data.title || `Video ${data.video_id}`;
    if (data.youtube_url) {
      stageYouTubeLink.href = data.youtube_url;
      stageYouTubeLink.style.display = 'inline-flex';
    } else {
      stageYouTubeLink.style.display = 'none';
    }

    tagVideoId.textContent = data.video_id || '-';
    tagDuration.textContent = `${data.duration || '?'}s`;
    
    const sizeBytes = data.clip_metadata ? data.clip_metadata.size_mb : null;
    tagFileSize.textContent = sizeBytes ? `${sizeBytes} MB` : '360p';
  }

  function updatePlayerSource() {
    if (!currentVideoData) return;

    if (currentViewMode === 'clip' && currentVideoData.is_clipped) {
      mainVideoPlayer.src = currentVideoData.clip_stream_url;
      btnDownload.href = `${currentVideoData.clip_stream_url}?download=1`;
      btnDownload.download = currentVideoData.clip_filename || 'clip.mp4';
      tabClip.classList.add('active');
      tabFull.classList.remove('active');
      playerDurationBadge.textContent = `${currentVideoData.clip_length || 15}s Clip`;
    } else {
      mainVideoPlayer.src = currentVideoData.video_stream_url;
      btnDownload.href = `${currentVideoData.video_stream_url}?download=1`;
      btnDownload.download = currentVideoData.video_filename || 'video.mp4';
      tabClip.classList.remove('active');
      tabFull.classList.add('active');
      playerDurationBadge.textContent = `${currentVideoData.duration || 0}s Full`;
    }

    mainVideoPlayer.load();
    mainVideoPlayer.play().catch(() => {
      // Autoplay with audio might be blocked by browser policy until user interaction
    });
  }

  function switchPlayerView(mode) {
    if (currentViewMode === mode) return;
    currentViewMode = mode;
    updatePlayerSource();
  }

  function loadItemIntoStage(item) {
    const videoData = {
      is_clipped: item.is_clip,
      clip_stream_url: item.is_clip ? item.stream_url : null,
      video_stream_url: item.stream_url,
      clip_filename: item.is_clip ? item.filename : null,
      video_filename: item.filename,
      video_id: item.video_id,
      title: item.filename,
      duration: item.duration,
      query: item.filename,
      youtube_url: `https://www.youtube.com/watch?v=${item.video_id}`,
      clip_metadata: item
    };

    loadVideoDataToStage(videoData);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
     LOCAL WINDOWS PLAYER TRIGGER
     ============================================================ */
  async function triggerOpenLocal(filename) {
    try {
      showToast(`Opening ${filename} in Windows player...`, 'info');
      const res = await fetch('/api/open-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to open local player');
      showToast('Opened in Windows player!', 'success');
    } catch (err) {
      showToast(`Local open error: ${err.message}`, 'error');
    }
  }

  /* ============================================================
     MEDIA LIBRARY / HISTORY
     ============================================================ */
  async function fetchLibrary(isFirstLoad = false) {
    try {
      const res = await fetch('/api/history');
      if (!res.ok) throw new Error('Failed to load library');
      const data = await res.json();

      libraryItems = data.items || [];
      libraryCountBadge.textContent = libraryItems.length;

      if (isFirstLoad && libraryItems.length > 0 && !currentVideoData) {
        btnLoadLatest.style.display = 'inline-flex';
      }

      renderLibraryGrid(libraryItems);
      checkSystemStatus();
    } catch (err) {
      libraryGrid.innerHTML = `<div class="library-empty">Failed to load media library: ${err.message}</div>`;
    }
  }

  function renderLibraryGrid(items) {
    if (!items || items.length === 0) {
      libraryGrid.innerHTML = `
        <div class="library-empty">
          <i class="fa-solid fa-folder-open" style="font-size:2rem; margin-bottom:10px; color:var(--text-subtle);"></i>
          <p>No video files in downloads folder yet.</p>
        </div>
      `;
      return;
    }

    libraryGrid.innerHTML = '';
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'library-card';

      const dateStr = item.created_at
        ? new Date(item.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

      const pillClass = item.is_clip ? 'is-clip' : 'is-full';
      const pillLabel = item.is_clip ? '15s Clip' : 'Full Video';

      card.innerHTML = `
        <div class="card-top-row">
          <span class="clip-type-pill ${pillClass}">${pillLabel}</span>
          <span style="font-family:var(--font-mono); font-size:0.7rem; color:var(--text-subtle);">${dateStr}</span>
        </div>
        <div class="card-title" title="${item.filename}">${item.filename}</div>
        <div class="card-meta-line">
          <span><i class="fa-solid fa-stopwatch"></i> ${item.duration ? item.duration + 's' : '-'}</span>
          <span><i class="fa-solid fa-file"></i> ${item.size_mb ? item.size_mb + ' MB' : '-'}</span>
          <span><i class="fa-solid fa-fingerprint"></i> ${item.video_id}</span>
        </div>
        <div class="card-actions-row">
          <button type="button" class="card-btn btn-play-card" data-action="play">
            <i class="fa-solid fa-play"></i> Stage
          </button>
          <button type="button" class="card-btn" data-action="open-local" title="Open in Windows Player">
            <i class="fa-solid fa-desktop"></i> OS
          </button>
          <a href="${item.download_url}" class="card-btn" title="Download MP4" download="${item.filename}">
            <i class="fa-solid fa-download"></i>
          </a>
          <button type="button" class="card-btn btn-delete-card" data-action="delete" title="Delete">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `;

      // Event listeners for card buttons
      card.querySelector('[data-action="play"]').addEventListener('click', () => loadItemIntoStage(item));
      card.querySelector('[data-action="open-local"]').addEventListener('click', () => triggerOpenLocal(item.filename));
      card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteVideoFile(item.filename));

      libraryGrid.appendChild(card);
    });
  }

  function filterLibraryDisplay() {
    const query = librarySearchInput.value.toLowerCase().trim();
    if (!query) {
      renderLibraryGrid(libraryItems);
      return;
    }

    const filtered = libraryItems.filter(item =>
      item.filename.toLowerCase().includes(query) ||
      item.video_id.toLowerCase().includes(query)
    );
    renderLibraryGrid(filtered);
  }

  async function deleteVideoFile(filename) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;

    try {
      const res = await fetch(`/api/video/${filename}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete file');
      showToast(`Deleted ${filename}`, 'info');

      // If this was active in player, reset or update
      if (currentVideoData && (currentVideoData.clip_filename === filename || currentVideoData.video_filename === filename)) {
        mainVideoPlayer.pause();
        mainVideoPlayer.src = '';
        activeVideoStage.style.display = 'none';
        playerPlaceholder.style.display = 'flex';
      }

      fetchLibrary(false);
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  // Start on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
