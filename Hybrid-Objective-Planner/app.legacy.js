const state = {
  catalog: [],
  objectiveIndex: new Map(),
  selected: new Set(),
  competitionSelections: new Map(),
  availability: 420,
  radarChart: null,
  apiBaseUrl: '',
  disciplineProfiles: new Map(),
  modalPreviousFocus: null,
  activeInsightSlide: 0,
  userProfileDefaults: null,
  userProfile: null,
  profileModalPreviousFocus: null,
  metricSelections: new Map(),
  projectionChart: null,
  progressionRates: new Map(),
  disciplineInterferenceMatrix: new Map(),
  objectiveMetrics: new Map(),
  latestInterference: null,
  latestInterferenceInsights: null,
  isProgressPlannerActive: false,
  weeklyTotals: { totalMinutes: 0, availability: 0 },
};

let selectionFeedbackTimeout = null;

const STORAGE_KEYS = {
  profile: 'hybridPlanner.userProfile',
  metrics: 'hybridPlanner.metricSelections',
};

const PROJECTION_WEEKS = 12;
const PROFILE_TRIGGER_SELECTOR = '[data-trigger-profile]';

const AXIS_LABELS = {
  body_composition: 'Body composition',
  strength_local_endurance: 'Strength & local endurance',
  power_speed: 'Power & speed',
  endurance: 'Endurance',
  motor_control_skill: 'Motor control & skill',
};

const DISPLAY_MINUTE_THRESHOLD = 45;

function formatHours(value, precision = 1) {
  const numeric = Number.isFinite(value) ? value : 0;
  const fixed = numeric.toFixed(precision);
  return precision > 0 ? fixed.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1') : fixed;
}

function formatMinutes(minutes, { alwaysHours = false, threshold = DISPLAY_MINUTE_THRESHOLD, precision = 1 } = {}) {
  const value = Number.isFinite(minutes) ? minutes : 0;
  const absolute = Math.abs(value);
  if (!alwaysHours && absolute < threshold) {
    return `${Math.round(value)} min`;
  }
  const hours = value / 60;
  return `${formatHours(hours, precision)} h`;
}

function formatRadarPointLabel(label) {
  if (typeof label !== 'string') return label;
  if (!label.includes('&')) {
    return label;
  }
  const parts = label.split('&').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return label;
  }
  const [first, ...rest] = parts;
  return [`${first} &`, rest.join(' & ') || null].filter(Boolean);
}

document.addEventListener('DOMContentLoaded', async () => {
  initAvailabilityControls();
  initRadarChart();
  initModalControls();
  initSelectionFeedback();
  initInsightCarousel();
  initProfileTriggers();
  try {
    await loadCatalog();
  } catch (error) {
    console.error('Failed to load catalog', error);
    showSelectionMessage('Could not load the objective catalog. Check the console for details.', 'error');
  }

  try {
    await loadDisciplineWeights();
  } catch (error) {
    console.error('Failed to load discipline weight data', error);
  }

  await loadUserProfileDefaults().catch((error) => console.error('Failed to load profile defaults', error));
  await Promise.all([
    loadProgressionRates().catch((error) => console.error('Failed to load progression rates', error)),
    loadObjectiveMetrics().catch((error) => console.error('Failed to load objective metrics', error)),
    loadDisciplineInterferenceMatrix().catch((error) =>
      console.error('Failed to load discipline interference map', error)
    ),
  ]);

  hydrateUserProfile();
  hydrateMetricSelections();
  buildProfileForm();
  initProgressPlannerView();
  updateProfileEntryStatus();

  updateWeeklyBalance();
  updateAnalyticsPlaceholders();
  renderProgressPlanner();

  if (!isProfileComplete()) {
    setTimeout(() => {
      openProfileModal();
    }, 0);
  }
});

async function loadCatalog() {
  const response = await fetch('data/objectives.json');
  if (!response.ok) {
    throw new Error(`Failed to load objectives.json (${response.status})`);
  }
  const payload = await response.json();
  state.catalog = payload.categories ?? [];
  indexObjectives();
  renderCatalog();
}

async function loadDisciplineWeights() {
  const response = await fetch('data/objectives_disciplines_weights.json');
  if (!response.ok) {
    throw new Error(`Failed to load objectives_disciplines_weights.json (${response.status})`);
  }

  const payload = await response.json();
  const objectives = Array.isArray(payload?.objectives) ? payload.objectives : [];
  state.disciplineProfiles.clear();

  for (const entry of objectives) {
    if (!entry?.id) continue;
    const weights = entry.disciplines_weights;
    if (!weights || typeof weights !== 'object') continue;

    const options = new Map();
    let baseProfile = null;

    const optionKeys = Object.keys(weights);
    const hasNested = optionKeys.some((key) => typeof weights[key] === 'object' && weights[key] !== null);

    if (hasNested) {
      for (const [optionName, optionWeights] of Object.entries(weights)) {
        if (!optionWeights || typeof optionWeights !== 'object') continue;
        const normalized = normalizeWeightMap(optionWeights);
        if (normalized.size) {
          options.set(optionName, normalized);
        }
      }

      if (options.size) {
        baseProfile = averageWeightMaps(Array.from(options.values()));
      }
    } else {
      baseProfile = normalizeWeightMap(weights);
    }

    state.disciplineProfiles.set(entry.id, {
      base: baseProfile,
      options,
    });
  }
}

function indexObjectives() {
  state.objectiveIndex.clear();
  for (const category of state.catalog) {
    for (const objective of category.objectives) {
      state.objectiveIndex.set(objective.id, {
        ...objective,
        categoryId: category.id,
        categoryTitle: category.title,
        minWeeklyMinutes: Math.round((objective.min_weekly_time_hours ?? 0) * 60),
      });
    }
  }
}

function renderCatalog() {
  const container = document.getElementById('objectives-container');
  container.innerHTML = '';

  if (!state.catalog.length) {
    container.innerHTML = '<p>No objectives available in the catalog.</p>';
    return;
  }

  for (const category of state.catalog) {
    const card = document.createElement('section');
    card.className = 'category-card';

    const header = document.createElement('div');
    header.className = 'category-card__header';

    const title = document.createElement('h3');
    title.textContent = category.title;

    const summary = document.createElement('p');
    summary.textContent = category.short_description;

    header.append(title, summary);

    const objectivesContainer = document.createElement('div');
    objectivesContainer.className = 'category-card__objectives';

    for (const objective of category.objectives) {
      const option = document.createElement('label');
      option.className = 'objective-option';

      const headerRow = document.createElement('div');
      headerRow.className = 'objective-option__header';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = objective.id;
      checkbox.dataset.categoryId = category.id;
      checkbox.dataset.categoryTitle = category.title;
      checkbox.dataset.objectiveTitle = objective.title;
      checkbox.checked = state.selected.has(objective.id);

      checkbox.addEventListener('change', handleSelectionChange);

      const objTitle = document.createElement('span');
      objTitle.className = 'objective-option__title';
      objTitle.textContent = objective.title;

      const timeBadge = document.createElement('span');
      timeBadge.className = 'objective-option__time';
      const minutes = Math.round((objective.min_weekly_time_hours ?? 0) * 60);
      timeBadge.textContent = minutes ? `≥ ${minutes} min/week` : 'Flexible time';

      headerRow.append(checkbox, objTitle, timeBadge);

      const description = document.createElement('p');
      description.textContent = objective.description;

      const supplemental = document.createElement('div');
      supplemental.className = 'objective-option__supplemental';
      supplemental.append(description);

      const competitionOptions = Array.isArray(objective.competition?.options)
        ? objective.competition.options.filter((value) => typeof value === 'string' && value.trim())
        : [];

      if (objective.competition_available && competitionOptions.length) {
        const competitionWrapper = document.createElement('div');
        competitionWrapper.className = 'objective-option__competition';

        const selectId = `competition-${objective.id}`;
        const competitionLabel = document.createElement('label');
        competitionLabel.setAttribute('for', selectId);
        competitionLabel.textContent = 'Competition focus';

        const competitionSelect = document.createElement('select');
        competitionSelect.id = selectId;
        competitionSelect.className = 'objective-option__select';

        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Select an option';
        competitionSelect.append(placeholderOption);

        const storedSelection = state.competitionSelections.get(objective.id);
        const defaultSelection = storedSelection || objective.competition?.selected_option || '';

        for (const optionValue of competitionOptions) {
          const optionElement = document.createElement('option');
          optionElement.value = optionValue;
          optionElement.textContent = optionValue;
          competitionSelect.append(optionElement);
        }

        competitionSelect.value = defaultSelection;

        competitionSelect.addEventListener('change', () => {
          if (competitionSelect.value) {
            state.competitionSelections.set(objective.id, competitionSelect.value);
          } else {
            state.competitionSelections.delete(objective.id);
          }
          updateWeeklyBalance();
          refreshAnalytics();
        });

        competitionWrapper.append(competitionLabel, competitionSelect);
        supplemental.append(competitionWrapper);
      }

      const tags = document.createElement('div');
      tags.className = 'objective-option__tags';
      tags.innerHTML = (objective.tags ?? [])
        .map((tag) => `<span class="objective-option__tag">${tag}</span>`)
        .join('');

      supplemental.append(tags);

      option.append(headerRow, supplemental);
      objectivesContainer.append(option);
    }

    card.append(header);

    const indicators = buildCategoryIndicators(category.metrics_tracked);
    if (indicators) {
      card.append(indicators);
    }

    card.append(objectivesContainer);
    container.append(card);
  }
}

function buildCategoryIndicators(metrics) {
  const list = Array.isArray(metrics)
    ? metrics.filter((metric) => typeof metric === 'string' && metric.trim())
    : [];

  if (!list.length) {
    return null;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'category-card__indicators';

  const title = document.createElement('p');
  title.className = 'category-card__indicators-title';
  title.textContent = 'Key indicators';

  const metricsList = document.createElement('ul');
  metricsList.className = 'category-card__metrics-list';

  for (const metric of list) {
    const item = document.createElement('li');
    item.textContent = metric.trim();
    metricsList.append(item);
  }

  wrapper.append(title, metricsList);
  return wrapper;
}

function initAvailabilityControls() {
  const slider = document.getElementById('availability-slider');
  const valueLabel = document.getElementById('availability-value');
  state.availability = parseInt(slider.value, 10);
  valueLabel.textContent = formatMinutes(state.availability, { alwaysHours: true });
  slider.addEventListener('input', () => {
    state.availability = parseInt(slider.value, 10);
    valueLabel.textContent = formatMinutes(state.availability, { alwaysHours: true });
    updateWeeklyBalance();
    renderProgressPlanner({ skipMetricCards: true });
  });
}

function initSelectionFeedback() {
  const closeButton = document.querySelector('.selection-feedback__close');
  if (closeButton) {
    closeButton.addEventListener('click', () => {
      hideSelectionFeedback();
    });
  }
}

function initInsightCarousel() {
  const track = document.getElementById('insight-carousel-track');
  if (!track) return;
  const slides = Array.from(track.querySelectorAll('.insight-slide'));
  if (!slides.length) return;

  const label = document.getElementById('insight-carousel-label');
  const progress = document.getElementById('insight-carousel-progress');

  const setSlide = (index) => {
    const total = slides.length;
    if (!total) return;
    const normalized = ((index % total) + total) % total;
    state.activeInsightSlide = normalized;
    track.style.transform = `translateX(-${normalized * 100}%)`;
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle('is-active', slideIndex === normalized);
    });

    if (label) {
      const descriptor = slides[normalized]?.dataset.slideLabel?.trim();
      label.textContent = descriptor || `Insight ${normalized + 1}`;
    }

    if (progress) {
      progress.textContent = `${normalized + 1}/${total}`;
    }
  };

  document.querySelectorAll('[data-carousel-dir]').forEach((button) => {
    button.addEventListener('click', () => {
      const direction = button.dataset.carouselDir === 'prev' ? -1 : 1;
      setSlide(state.activeInsightSlide + direction);
    });
  });

  setSlide(state.activeInsightSlide);
}

function initModalControls() {
  const modal = document.getElementById('selection-modal');
  if (!modal) return;

  const dismissElements = modal.querySelectorAll('[data-modal-dismiss]');
  dismissElements.forEach((element) => {
    element.addEventListener('click', hideSelectionModal);
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      hideSelectionModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) {
      hideSelectionModal();
    }
  });
}

function showSelectionModal(message) {
  const modal = document.getElementById('selection-modal');
  const messageElement = document.getElementById('selection-modal-message');
  const focusTarget = modal?.querySelector('.modal__close');
  if (!modal || !messageElement) return;

  state.modalPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  messageElement.textContent = message;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  if (focusTarget instanceof HTMLElement) {
    focusTarget.focus();
  }
}

function hideSelectionModal() {
  const modal = document.getElementById('selection-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');

  if (state.modalPreviousFocus && state.modalPreviousFocus instanceof HTMLElement) {
    state.modalPreviousFocus.focus();
  }
  state.modalPreviousFocus = null;
}

function clearCompetitionSelection(objectiveId) {
  state.competitionSelections.delete(objectiveId);
  const select = document.getElementById(`competition-${objectiveId}`);
  if (select) {
    select.value = '';
  }
}

function handleSelectionChange(event) {
  const checkbox = event.target;
  const { checked } = checkbox;
  const categoryId = checkbox.dataset.categoryId;
  const objectiveId = checkbox.value;
  const objectiveTitle = checkbox.dataset.objectiveTitle;
  const categoryTitle = checkbox.dataset.categoryTitle;

  if (checked) {
    const categoryInputs = Array.from(document.querySelectorAll(`input[data-category-id="${categoryId}"]`));
    const replacedObjectives = [];

    for (const input of categoryInputs) {
      if (input === checkbox || !input.checked) continue;
      input.checked = false;
      const previousId = input.value;
      const previousTitle = input.dataset.objectiveTitle;
      state.selected.delete(previousId);
      clearCompetitionSelection(previousId);
      replacedObjectives.push(previousTitle);
    }

    if (state.selected.size >= 3) {
      checkbox.checked = false;
      showSelectionMessage('You can select up to three objectives at a time.', 'warning');
      showSelectionModal('You can select up to three objectives at a time. Deselect one to add a different focus.');
      return;
    }

    state.selected.add(objectiveId);

    if (replacedObjectives.length) {
      const replacedTitle = replacedObjectives[0];
      showSelectionMessage(
        `Replaced “${replacedTitle}” with “${objectiveTitle}” in ${categoryTitle}.`,
        'info'
      );
    } else {
      showSelectionMessage(`Added “${objectiveTitle}” (${categoryTitle}).`, 'info');
    }
  } else {
    state.selected.delete(objectiveId);
    clearCompetitionSelection(objectiveId);
    showSelectionMessage(`Removed “${objectiveTitle}” (${categoryTitle}).`, 'info');
  }

  updateWeeklyBalance();
  renderProgressPlanner();
  refreshAnalytics();
}

function showSelectionMessage(message, tone = 'info') {
  const wrapper = document.querySelector('.selection-feedback');
  const messageElement = document.getElementById('selection-message');
  if (!wrapper || !messageElement) return;
  if (!message) {
    hideSelectionFeedback();
    return;
  }

  messageElement.textContent = message;
  wrapper.dataset.tone = tone;
  wrapper.classList.add('is-visible');

  if (selectionFeedbackTimeout) {
    clearTimeout(selectionFeedbackTimeout);
  }
  selectionFeedbackTimeout = setTimeout(() => {
    hideSelectionFeedback();
  }, 5000);
}

function hideSelectionFeedback() {
  const wrapper = document.querySelector('.selection-feedback');
  if (!wrapper) return;
  wrapper.classList.remove('is-visible');
  delete wrapper.dataset.tone;
  if (selectionFeedbackTimeout) {
    clearTimeout(selectionFeedbackTimeout);
    selectionFeedbackTimeout = null;
  }
}

function updateWeeklyBalance() {
  const summary = document.getElementById('time-summary');
  const status = document.getElementById('time-status');
  const fill = document.getElementById('balance-fill');
  const list = document.getElementById('selected-list');
  const loadKpiValue = document.getElementById('kpi-load-value');
  const loadKpiDescription = document.getElementById('kpi-load-description');
  const objectivesKpiValue = document.getElementById('kpi-objectives-value');
  const objectivesKpiDescription = document.getElementById('kpi-objectives-description');

  const selectedIds = Array.from(state.selected);
  const selectedCount = selectedIds.length;
  const totalMinutes = selectedIds.reduce((acc, id) => {
    const entry = state.objectiveIndex.get(id);
    return acc + (entry?.minWeeklyMinutes ?? 0);
  }, 0);

  const formattedTotal = formatMinutes(totalMinutes, { alwaysHours: true });
  const formattedAvailability = formatMinutes(state.availability, { alwaysHours: true });
  summary.textContent = `${formattedTotal} of ${formattedAvailability} committed this week.`;

  if (loadKpiValue) {
    loadKpiValue.textContent = formattedTotal;
  }
  if (loadKpiDescription) {
    loadKpiDescription.textContent = formatTimeConclusion({ totalMinutes, availability: state.availability });
  }
  if (objectivesKpiValue) {
    objectivesKpiValue.textContent = `${selectedCount}/3`;
  }
  if (objectivesKpiDescription) {
    let objectivesMessage = 'Add up to three focus areas.';
    if (selectedCount === 1) {
      objectivesMessage = 'Add another objective to unlock interference.';
    } else if (selectedCount === 2) {
      objectivesMessage = 'Interference is live. Use the final slot only if needed.';
    } else if (selectedCount === 3) {
      objectivesMessage = 'Max selections reached. Deselect to swap focus.';
    }
    objectivesKpiDescription.textContent = objectivesMessage;
  }

  list.innerHTML = '';
  const categoryTotals = new Map();
  for (const id of selectedIds) {
    const entry = state.objectiveIndex.get(id);
    if (!entry) continue;
    const item = document.createElement('li');
    const minutes = entry.minWeeklyMinutes ?? 0;
    const minutesLabel = minutes ? `${formatMinutes(minutes, { alwaysHours: true })}/week` : 'Flexible time';

    const primary = document.createElement('span');
    primary.className = 'selected-list__primary';
    primary.textContent = `${entry.title ?? id} · ${minutesLabel}`;
    item.append(primary);

    const competitionChoice = state.competitionSelections.get(id);
    if (competitionChoice) {
      const meta = document.createElement('span');
      meta.className = 'selected-list__meta';
      meta.textContent = `Competition: ${competitionChoice}`;
      item.append(meta);
    }
    list.append(item);

    const categoryLabel = entry.categoryTitle ?? 'Other';
    const current = categoryTotals.get(categoryLabel) ?? 0;
    categoryTotals.set(categoryLabel, current + minutes);
  }

  const ratio = state.availability ? totalMinutes / state.availability : 0;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  fill.style.width = `${(clampedRatio * 100).toFixed(1)}%`;

  let statusClass = 'status--idle';
  let statusText = 'Select objectives to balance your week.';

  if (totalMinutes === 0) {
    statusClass = 'status--idle';
    statusText = 'Select objectives to balance your week.';
  } else if (ratio < 0.85) {
    statusClass = 'status--positive';
    const remaining = Math.round(state.availability - totalMinutes);
    statusText = `${formatMinutes(remaining, { threshold: DISPLAY_MINUTE_THRESHOLD })} still free this week.`;
  } else if (ratio <= 1.05) {
    statusClass = 'status--warning';
    if (ratio < 1) {
      const remaining = Math.round(state.availability - totalMinutes);
      statusText = `Nearing capacity. ${formatMinutes(remaining, { threshold: DISPLAY_MINUTE_THRESHOLD })} remain.`;
    } else {
      const over = Math.round(totalMinutes - state.availability);
      statusText = `Slight overload: +${formatMinutes(over, { threshold: DISPLAY_MINUTE_THRESHOLD })}.`;
    }
  } else {
    statusClass = 'status--danger';
    const over = Math.round(totalMinutes - state.availability);
    statusText = `Critical overload: over by ${formatMinutes(over, { threshold: DISPLAY_MINUTE_THRESHOLD })}.`;
  }

  status.className = `status ${statusClass}`;
  status.textContent = statusText;

  state.weeklyTotals = { totalMinutes, availability: state.availability };

  updateLoadSummary({ totalMinutes, categoryTotals, availability: state.availability });
}

function initRadarChart() {
  const ctx = document.getElementById('profileRadar');
  if (!ctx) return;
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js is not available. Radar chart will be disabled.');
    return;
  }

  state.radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: Object.values(AXIS_LABELS),
      datasets: [
        {
          label: 'Combined profile',
          data: new Array(Object.keys(AXIS_LABELS).length).fill(0),
          borderColor: 'rgba(96, 165, 250, 1)',
          backgroundColor: 'rgba(96, 165, 250, 0.28)',
          borderWidth: 3,
          pointBackgroundColor: '#f8fafc',
          pointBorderColor: 'rgba(96, 165, 250, 1)',
          pointHoverBackgroundColor: '#f8fafc',
          pointHoverBorderColor: 'rgba(59, 130, 246, 1)',
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      aspectRatio: 1.3,
      layout: {
        padding: {
          top: 10,
          right: 10,
          bottom: 10,
          left: 10,
        },
      },
      scales: {
        r: {
          min: 0,
          max: 1,
          ticks: {
            showLabelBackdrop: false,
            stepSize: 0.2,
            color: 'rgba(226, 232, 240, 0.7)',
            backdropColor: 'transparent',
            font: {
              size: 12,
            },
          },
          grid: {
            color: 'rgba(148, 197, 255, 0.35)',
            lineWidth: 1.5,
          },
          angleLines: {
            color: 'rgba(148, 197, 255, 0.45)',
            lineWidth: 1.5,
          },
          pointLabels: {
            color: 'rgba(241, 245, 249, 0.95)',
            font: {
              size: 13,
              weight: '600',
              lineHeight: 1.3,
            },
            padding: 16,
            callback: (label) => formatRadarPointLabel(label),
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
      },
    },
  });
}

function updateRadarChart(labels, values) {
  if (!state.radarChart) return;
  state.radarChart.data.labels = labels;
  state.radarChart.data.datasets[0].data = values;
  state.radarChart.update();
}

function updateAnalyticsPlaceholders() {
  updateThermometer(null, 'Waiting for selections…');
  updateInterferenceInsights({
    summary: 'Select 2–3 objectives to evaluate interference.',
    reasons: [],
    severity: 'none',
    thermometerLabel: 'Interference requires 2–3 objectives.',
  });
  updateRadarChart(Object.values(AXIS_LABELS), new Array(Object.keys(AXIS_LABELS).length).fill(0));
  updatePhysiologicalBalance(null);
  updateTrainingSuggestion({ severity: 'none', physiological: null, selection: [] });
  state.latestInterference = null;
  state.latestInterferenceInsights = null;
  renderProgressPlanner({ skipMetricCards: true });
}

async function refreshAnalytics() {
  const selection = Array.from(state.selected);

  if (!selection.length) {
    updateAnalyticsPlaceholders();
    return;
  }

  if (selection.length > 3) {
    updateThermometer(null, 'Interference is only available for up to 3 objectives.');
    updateInterferenceInsights({
      summary: 'Limit the analysis to three objectives to view interference insights.',
      reasons: [],
      severity: 'none',
      thermometerLabel: 'Selection exceeds the supported limit.',
    });
    updateRadarChart(Object.values(AXIS_LABELS), new Array(Object.keys(AXIS_LABELS).length).fill(0));
    updatePhysiologicalBalance(null);
    updateTrainingSuggestion({ severity: 'none', physiological: null, selection });
    state.latestInterference = null;
    state.latestInterferenceInsights = null;
    renderProgressPlanner({ skipMetricCards: true });
    return;
  }

  try {
    const payload = { objectives: selection };

    if (selection.length === 1) {
      updateThermometer(null, 'Select another objective to evaluate interference.');
      updateInterferenceInsights({
        summary: 'Add one more objective to evaluate interference insights.',
        reasons: [],
        severity: 'none',
        thermometerLabel: 'Interference requires at least two objectives.',
      });

      const radar = await fetchJson('/api/radar', payload);

      if (radar?.labels && radar?.values) {
        updateRadarChart(radar.labels, radar.values);
      } else {
        updateRadarChart(
          Object.values(AXIS_LABELS),
          new Array(Object.keys(AXIS_LABELS).length).fill(0)
        );
      }

      const balance = buildPhysiologicalBalance(radar);
      updatePhysiologicalBalance(balance);
      updateTrainingSuggestion({ severity: 'none', physiological: balance, selection });
      state.latestInterference = null;
      state.latestInterferenceInsights = null;
      renderProgressPlanner({ skipMetricCards: true });
      return;
    }

    const [interference, radar] = await Promise.all([
      fetchJson('/api/interference', payload),
      fetchJson('/api/radar', payload),
    ]);

    const insights = buildInterferenceInsights(interference, selection);
    state.latestInterference = interference;
    state.latestInterferenceInsights = insights;
    const interferenceScore = typeof interference?.score === 'number' ? interference.score : null;
    updateThermometer(interferenceScore, insights.thermometerLabel);
    updateInterferenceInsights(insights);

    if (radar?.labels && radar?.values) {
      updateRadarChart(radar.labels, radar.values);
    } else {
      updateRadarChart(Object.values(AXIS_LABELS), new Array(Object.keys(AXIS_LABELS).length).fill(0));
    }

    const balance = buildPhysiologicalBalance(radar);
    updatePhysiologicalBalance(balance);
    updateTrainingSuggestion({ severity: insights.severity, physiological: balance, selection });
    renderProgressPlanner({ skipMetricCards: true });
  } catch (error) {
    console.error('Failed to refresh analytics', error);
    updateThermometer(null, 'Unable to refresh the analytics. Check the console logs.');
    updateInterferenceInsights({
      summary: 'Could not load interference insights. Try again in a moment.',
      reasons: [],
      severity: 'error',
      thermometerLabel: 'Interference unavailable.',
    });
    updateRadarChart(Object.values(AXIS_LABELS), new Array(Object.keys(AXIS_LABELS).length).fill(0));
    updatePhysiologicalBalance(null);
    updateTrainingSuggestion({ severity: 'error', physiological: null, selection });
    state.latestInterference = null;
    state.latestInterferenceInsights = null;
    renderProgressPlanner({ skipMetricCards: true });
  }
}

async function fetchJson(path, body) {
  const response = await fetch(`${state.apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request to ${path} failed: ${response.status} ${errorText}`);
  }
  return response.json();
}

function updateThermometer(score, labelText) {
  const fill = document.getElementById('thermometer-fill');
  const label = document.getElementById('thermometer-label');
  const value = document.getElementById('thermometer-value');
  const kpiValue = document.getElementById('kpi-interference-value');
  const kpiDescription = document.getElementById('kpi-interference-description');
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const clamped = hasScore ? clamp01(score) : 0;
  if (fill) {
    fill.style.height = `${(clamped * 100).toFixed(0)}%`;
    fill.style.filter = hasScore ? `hue-rotate(${(1 - clamped) * 90}deg)` : 'none';
  }
  const message = labelText || 'Interference unavailable.';
  if (label) {
    label.textContent = message;
  }
  if (value) {
    value.textContent = hasScore ? `${Math.round(clamped * 100)}%` : '—';
  }
  if (kpiValue) {
    kpiValue.textContent = hasScore ? `${Math.round(clamped * 100)}%` : '—';
  }
  if (kpiDescription) {
    kpiDescription.textContent = message;
  }
}

function updateInterferenceInsights(model) {
  const summaryElement = document.getElementById('interference-summary');
  const reasonsList = document.getElementById('interference-reasons');
  if (!summaryElement || !reasonsList) return;

  const safeModel = model ?? {
    summary: 'Select 2–3 objectives to evaluate interference.',
    reasons: [],
    severity: 'none',
  };

  summaryElement.textContent = safeModel.summary;
  reasonsList.innerHTML = '';

  const reasons = Array.isArray(safeModel.reasons) ? safeModel.reasons : [];
  for (const reason of reasons) {
    const item = document.createElement('li');
    item.textContent = reason;
    reasonsList.append(item);
  }
}

function buildInterferenceInsights(interference, selectionIds) {
  const count = Array.isArray(selectionIds) ? selectionIds.length : 0;
  const score = typeof interference?.score === 'number' ? clamp01(interference.score) : null;

  if (count <= 1) {
    return {
      summary: 'Select 2–3 objectives to evaluate interference.',
      reasons: [],
      severity: 'none',
      thermometerLabel: 'Interference requires 2–3 objectives.',
    };
  }

  if (score === null) {
    return {
      summary: 'Interference insights unavailable for the current selection.',
      reasons: [],
      severity: 'none',
      thermometerLabel: 'Interference unavailable.',
    };
  }

  let severity = 'high';
  if (score < 0.3) {
    severity = 'low';
  } else if (score < 0.6) {
    severity = 'moderate';
  }

  const severityLabels = {
    low: 'Low interference',
    moderate: 'Moderate interference',
    high: 'High interference',
  };

  const summaryMessages = {
    low: 'Low interference risk — sessions complement each other and recovery overlap is limited.',
    moderate: 'Moderate interference — stagger similar stressors and leave breathing room for recovery.',
    high: 'High interference — separate the heaviest or most intense days to keep progress moving.',
  };

  const summary = summaryMessages[severity];
  const thermometerLabel = severityLabels[severity];

  const breakdown = Array.isArray(interference?.breakdown) ? interference.breakdown : [];
  const formattedBreakdown = breakdown
    .map((item) => {
      const impact = typeof item?.interference === 'number' ? clamp01(item.interference) : clamp01(item?.contribution ?? 0);
      const axisKey = typeof item?.axis === 'string' ? item.axis : null;
      const label = formatInterferenceAxisLabel(axisKey, item?.label);
      if (!label) return null;
      const description = INTERFERENCE_AXIS_DESCRIPTIONS[axisKey] ?? `${label}: overlap in similar training demands.`;
      return { label, impact, description };
    })
    .filter(Boolean)
    .sort((a, b) => b.impact - a.impact);

  const reasons = [];
  const MAX_REASONS = 3;
  for (const item of formattedBreakdown.slice(0, MAX_REASONS)) {
    const percent = Math.round(item.impact * 100);
    reasons.push(`${item.description} (~${percent}% of the combined stress).`);
  }

  if (reasons.length < MAX_REASONS) {
    const flags = Array.isArray(interference?.redundancy_flags)
      ? interference.redundancy_flags.filter((flag) => typeof flag === 'string' && flag.trim())
      : [];
    for (const flag of flags) {
      if (reasons.length >= MAX_REASONS) break;
      reasons.push(`Watch for repeated work: ${flag}.`);
    }
  }

  if (!reasons.length) {
    reasons.push('Overall overlap across sessions is the main source of interference.');
  }

  return { summary, reasons, severity, thermometerLabel };
}

const INTERFERENCE_AXIS_LABELS = {
  hormonal: 'Hormonal & inflammatory stress',
  energy: 'Bioenergetic mismatch',
  fibers: 'Fiber-type mismatch',
  complexity: 'Motor complexity',
  neuromuscular: 'Neuromuscular fatigue',
  metabolic: 'Metabolic stress',
  cardio: 'Cardio-ventilatory load',
  structural: 'Structural impact',
  psycho: 'Psychophysiological load',
  local: 'Local muscular overlap',
};

const INTERFERENCE_AXIS_DESCRIPTIONS = {
  hormonal: 'Recovery overlap from similar heavy efforts taxes hormonal systems',
  energy: 'Energy systems collide with both objectives chasing the same fuel pathways',
  fibers: 'Both goals target the same muscle fibre qualities',
  complexity: 'High skill demand in both areas increases coordination fatigue',
  neuromuscular: 'Neuromuscular fatigue stacks because of similar high-force work',
  metabolic: 'Metabolic stress piles up across sessions',
  cardio: 'Cardio-ventilatory load is shared between the objectives',
  structural: 'Structural impact builds up in the same tissues',
  psycho: 'Mental and nervous system load compounds between sessions',
  local: 'Local muscular fatigue targets the same regions',
};

function formatInterferenceAxisLabel(axis, fallback) {
  if (typeof fallback === 'string' && fallback.trim()) {
    return fallback.trim();
  }
  if (typeof axis === 'string' && INTERFERENCE_AXIS_LABELS[axis]) {
    return INTERFERENCE_AXIS_LABELS[axis];
  }
  if (typeof axis === 'string' && axis.trim()) {
    return axis.replace(/_/g, ' ');
  }
  return null;
}

function updatePhysiologicalBalance(model) {
  const breakdown = document.getElementById('physiological-breakdown');
  const summary = document.getElementById('physiological-summary');
  if (!breakdown || !summary) return;

  breakdown.innerHTML = '';

  if (
    !model ||
    !Array.isArray(model.entries) ||
    !model.entries.length ||
    model.entries.every((entry) => entry.percent === 0)
  ) {
    summary.textContent = 'Waiting for selections…';
    return;
  }

  for (const entry of model.entries) {
    const dt = document.createElement('dt');
    dt.textContent = entry.label;
    const dd = document.createElement('dd');
    dd.textContent = `${entry.percent}%`;
    breakdown.append(dt, dd);
  }

  summary.textContent = model.summary;
}

function buildPhysiologicalBalance(radar) {
  if (!radar || typeof radar !== 'object') {
    return null;
  }

  const axisKeys = Object.keys(AXIS_LABELS);
  const values = axisKeys.map((axis, index) => {
    if (radar.axes && typeof radar.axes === 'object' && axis in radar.axes) {
      return Number(radar.axes[axis]) || 0;
    }
    if (Array.isArray(radar.values) && radar.values[index] !== undefined) {
      return Number(radar.values[index]) || 0;
    }
    return 0;
  });

  const total = values.reduce((acc, value) => acc + Math.max(0, value), 0);
  const entries = axisKeys.map((axis, index) => {
    const raw = Math.max(0, values[index]);
    const percent = total > 0 ? Math.round((raw / total) * 100) : 0;
    return { axis, label: AXIS_LABELS[axis], percent, raw };
  });

  const sorted = [...entries].sort((a, b) => b.raw - a.raw);
  const top = sorted[0];
  const second = sorted[1];

  if (!top || total <= 0) {
    return {
      entries,
      summary: 'Add objectives to view the physiological balance.',
      emphasis: 'none',
      dominantLabel: null,
    };
  }

  const topShare = total > 0 ? top.raw / total : 0;
  const secondShare = total > 0 && second ? second.raw / total : 0;

  let emphasis = 'balanced';
  if (topShare >= 0.5 && topShare - secondShare >= 0.15) {
    emphasis = 'dominant';
  } else if (topShare - secondShare >= 0.1) {
    emphasis = 'tilt';
  }

  let summary;
  const topPercent = Math.round(topShare * 100);
  if (emphasis === 'dominant') {
    summary = `Clear ${top.label.toLowerCase()} emphasis (${topPercent}%). Consider layering complementary work to round out the profile.`;
  } else if (emphasis === 'tilt' && second) {
    const secondPercent = Math.round(secondShare * 100);
    summary = `${top.label} leads (${topPercent}%) with ${second.label.toLowerCase()} close behind (${secondPercent}%). Balance supporting work accordingly.`;
  } else if (second) {
    const secondPercent = Math.round(secondShare * 100);
    summary = `Balanced distribution between ${top.label.toLowerCase()} (${topPercent}%) and ${second.label.toLowerCase()} (${secondPercent}%).`;
  } else {
    summary = `${top.label} drives the profile (${topPercent}%).`;
  }

  return {
    entries,
    summary,
    emphasis,
    dominantLabel: top.label,
  };
}

function updateTrainingSuggestion(context) {
  const suggestion = document.getElementById('training-suggestion');
  if (!suggestion) return;

  const severity = context?.severity ?? 'none';
  const physiological = context?.physiological ?? null;
  const selectionIds = Array.isArray(context?.selection) ? context.selection : [];
  const topDisciplines = computeTopDisciplines(selectionIds);

  suggestion.innerHTML = '';

  if (!selectionIds.length) {
    suggestion.textContent = 'Add objectives to receive tailored suggestions.';
    return;
  }

  if (severity === 'error') {
    suggestion.textContent = 'Training suggestions are unavailable right now.';
    return;
  }

  const paragraphs = [];

  if (severity === 'none') {
    paragraphs.push('Select one more objective to evaluate interference. Use the highlighted disciplines to organise your week.');
  } else {
    const severityAdvice = {
      low: 'Maintain complementary scheduling and consolidate sessions that naturally align.',
      moderate:
        'Stagger high-impact days: follow heavy strength or long endurance work with lighter skill or recovery-focused sessions.',
      high: 'Separate heavy strength and endurance hitters to reduce overlap and keep recovery on track.',
    };

    const emphasisAdviceMap = {
      Endurance: 'Layer focused strength or power work to support broad performance.',
      'Strength & local endurance': 'Blend in aerobic conditioning so endurance qualities keep pace.',
      'Power & speed': 'Pair high-speed work with foundational strength or endurance blocks for balance.',
      'Motor control & skill': 'Add force-production or endurance work to translate skills into performance.',
      'Body composition': 'Combine physique work with strength or endurance emphasis to sustain functionality.',
    };

    const baseAdvice = severityAdvice[severity] ?? 'Balance sessions to manage recovery and overlap.';
    paragraphs.push(baseAdvice);

    if (physiological?.emphasis === 'dominant' && physiological.dominantLabel) {
      const emphasisAdvice = emphasisAdviceMap[physiological.dominantLabel] ?? '';
      if (emphasisAdvice) {
        paragraphs.push(emphasisAdvice);
      }
    }
  }

  paragraphs.forEach((text) => {
    if (!text) return;
    const p = document.createElement('p');
    p.textContent = text;
    suggestion.append(p);
  });

  if (!topDisciplines.length) {
    const fallback = document.createElement('p');
    fallback.className = 'insight-detail';
    fallback.textContent = 'Discipline insights are unavailable for this combination.';
    suggestion.append(fallback);
    return;
  }

  const intro = document.createElement('p');
  intro.className = 'insight-detail';
  intro.textContent = severity === 'none' ? 'Key training blocks for this focus:' : 'Prioritise these training blocks:';
  suggestion.append(intro);

  const list = document.createElement('ul');
  list.className = 'insight-list insight-list--bulleted';

  topDisciplines.forEach((item) => {
    const li = document.createElement('li');
    if (typeof item.percent === 'number') {
      li.textContent = `${item.discipline}: ~${item.percent}% of the combined focus.`;
    } else {
      li.textContent = item.discipline;
    }
    list.append(li);
  });

  suggestion.append(list);
}

function updateLoadSummary({ totalMinutes, categoryTotals, availability }) {
  const totalElement = document.getElementById('load-summary-total');
  const distributionList = document.getElementById('load-summary-distribution');
  if (!totalElement || !distributionList) return;

  distributionList.innerHTML = '';

  if (!totalMinutes) {
    totalElement.textContent = 'No objectives selected yet.';
    return;
  }

  const totalHours = formatMinutes(totalMinutes, { alwaysHours: true });
  totalElement.textContent = `Total weekly load: ${totalHours}/week`;

  const detail = document.createElement('span');
  detail.className = 'insight-detail insight-detail--inline';
  detail.textContent = formatTimeConclusion({ totalMinutes, availability });
  totalElement.append(document.createElement('br'), detail);

  const entries = Array.from(categoryTotals.entries()).sort((a, b) => b[1] - a[1]);
  for (const [category, minutes] of entries) {
    const item = document.createElement('li');
    const percent = totalMinutes ? Math.round((minutes / totalMinutes) * 100) : 0;
    item.textContent = `${category}: ${percent}%`;
    distributionList.append(item);
  }
}

function computeTopDisciplines(selectionIds) {
  if (!Array.isArray(selectionIds) || !selectionIds.length) {
    return [];
  }

  const totals = new Map();

  for (const id of selectionIds) {
    const objective = state.objectiveIndex.get(id);
    const profile = resolveObjectiveDisciplineWeights(id);
    if (!(profile instanceof Map) || profile.size === 0) continue;

    const minutes = Number(objective?.minWeeklyMinutes) || 0;
    const weighting = minutes > 0 ? minutes : 60;

    profile.forEach((weight, discipline) => {
      if (!Number.isFinite(weight) || weight <= 0) return;
      const current = totals.get(discipline) ?? 0;
      totals.set(discipline, current + weight * weighting);
    });
  }

  if (!totals.size) {
    return [];
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const totalValue = sorted.reduce((acc, [, value]) => acc + value, 0);

  return sorted.slice(0, 3).map(([discipline, value]) => ({
    discipline,
    percent: totalValue > 0 ? Math.round((value / totalValue) * 100) : null,
  }));
}

function resolveObjectiveDisciplineWeights(objectiveId) {
  if (!objectiveId) return null;
  const entry = state.disciplineProfiles.get(objectiveId);
  if (!entry) return null;

  const option = state.competitionSelections.get(objectiveId);
  if (option && entry.options instanceof Map && entry.options.has(option)) {
    return entry.options.get(option);
  }

  if (entry.base instanceof Map && entry.base.size) {
    return entry.base;
  }

  if (entry.options instanceof Map) {
    const first = entry.options.values().next();
    if (!first.done) {
      return first.value;
    }
  }

  return null;
}

function normalizeWeightMap(weights) {
  const entries = weights instanceof Map ? [...weights.entries()] : Object.entries(weights ?? {});
  const numericEntries = entries
    .map(([name, value]) => [name, Number(value)])
    .filter(([, value]) => Number.isFinite(value) && value > 0);

  const total = numericEntries.reduce((acc, [, value]) => acc + value, 0);
  if (!total) {
    return new Map();
  }

  return new Map(numericEntries.map(([name, value]) => [name, value / total]));
}

function averageWeightMaps(weightMaps) {
  if (!Array.isArray(weightMaps) || !weightMaps.length) {
    return new Map();
  }

  const aggregate = new Map();
  let count = 0;

  for (const map of weightMaps) {
    if (!(map instanceof Map) || map.size === 0) continue;
    count += 1;
    map.forEach((value, key) => {
      if (!Number.isFinite(value)) return;
      const current = aggregate.get(key) ?? 0;
      aggregate.set(key, current + value);
    });
  }

  if (!count || !aggregate.size) {
    return new Map();
  }

  aggregate.forEach((value, key) => {
    aggregate.set(key, value / count);
  });

  return normalizeWeightMap(aggregate);
}

function formatTimeConclusion({ totalMinutes, availability }) {
  const available = Number(availability) || 0;
  if (!available) {
    return 'Set your available hours to gauge how tight the plan is.';
  }

  const ratio = totalMinutes / available;

  if (ratio <= 0.75) {
    return 'You have comfortable buffer time—layer supportive work or extra recovery as needed.';
  }
  if (ratio < 1) {
    return 'There is still breathing room. Protect recovery or add skill practice with the spare time.';
  }
  if (ratio <= 1.15) {
    return 'The schedule is packed. Prioritise the most important sessions to stay realistic.';
  }
  return 'Time budget exceeded—expect trade-offs until you trim sessions or extend your availability.';
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

async function loadUserProfileDefaults() {
  if (state.userProfileDefaults) {
    return state.userProfileDefaults;
  }
  const response = await fetch('data/user_profile_defaults.json');
  if (!response.ok) {
    throw new Error(`Failed to load user_profile_defaults.json (${response.status})`);
  }
  state.userProfileDefaults = await response.json();
  return state.userProfileDefaults;
}

async function loadProgressionRates() {
  const response = await fetch('data/progression_rates.json');
  if (!response.ok) {
    throw new Error(`Failed to load progression_rates.json (${response.status})`);
  }
  const payload = await response.json();
  state.progressionRates.clear();
  (Array.isArray(payload) ? payload : []).forEach((entry) => {
    if (!entry?.discipline) return;
    state.progressionRates.set(entry.discipline, entry);
  });
}

async function loadObjectiveMetrics() {
  const response = await fetch('data/objective_metrics.json');
  if (!response.ok) {
    throw new Error(`Failed to load objective_metrics.json (${response.status})`);
  }
  const payload = await response.json();
  state.objectiveMetrics.clear();
  if (payload && typeof payload === 'object') {
    Object.entries(payload).forEach(([objectiveId, value]) => {
      if (!objectiveId) return;
      const metrics = Array.isArray(value?.metrics) ? value.metrics : [];
      state.objectiveMetrics.set(objectiveId, metrics.filter((metric) => typeof metric?.id === 'string'));
    });
  }
}

async function loadDisciplineInterferenceMatrix() {
  const response = await fetch('data/discipline_interference_map.json');
  if (!response.ok) {
    throw new Error(`Failed to load discipline_interference_map.json (${response.status})`);
  }
  const payload = await response.json();
  state.disciplineInterferenceMatrix.clear();
  const entries = Array.isArray(payload?.disciplines) ? payload.disciplines : [];
  entries.forEach((entry) => {
    if (!entry?.id) return;
    state.disciplineInterferenceMatrix.set(entry.id, {
      label: entry.label ?? entry.id,
      base_weight: Number(entry.base_weight) || 0,
      axes: entry.axes ?? {},
    });
  });
}

function hydrateUserProfile() {
  const stored = readStoredJSON(STORAGE_KEYS.profile);
  const freshProfile = createEmptyProfile();
  if (!stored || typeof stored !== 'object') {
    state.userProfile = freshProfile;
    return;
  }

  const merged = {
    ...freshProfile,
    age: toNumber(stored.age, freshProfile.age),
    weight: toNumber(stored.weight, freshProfile.weight),
    height: toNumber(stored.height, freshProfile.height),
    gender: typeof stored.gender === 'string' ? stored.gender : freshProfile.gender,
    recovery_state:
      typeof stored.recovery_state === 'string' ? stored.recovery_state : freshProfile.recovery_state,
    adherence: typeof stored.adherence === 'string' ? stored.adherence : freshProfile.adherence,
    resources: Array.isArray(stored.resources)
      ? stored.resources.filter((id) => typeof id === 'string')
      : freshProfile.resources,
  };

  merged.experience = { ...freshProfile.experience };
  if (stored.experience && typeof stored.experience === 'object') {
    Object.keys(merged.experience).forEach((disciplineId) => {
      if (typeof stored.experience[disciplineId] === 'string') {
        merged.experience[disciplineId] = stored.experience[disciplineId];
      }
    });
  }

  state.userProfile = merged;
}

function createEmptyProfile() {
  const defaults = state.userProfileDefaults ?? {};
  const experience = {};
  const disciplineList = Array.isArray(defaults.disciplines) ? defaults.disciplines : [];
  const fallbackExperience = defaults.default_experience ?? 'intermediate';
  disciplineList.forEach((discipline) => {
    if (!discipline?.id) return;
    experience[discipline.id] = fallbackExperience;
  });

  return {
    age: defaults.age_range?.default ?? null,
    gender: null,
    weight: defaults.weight_range?.default ?? null,
    height: defaults.height_range?.default ?? null,
    experience,
    recovery_state: defaults.recovery_states?.[1]?.id ?? defaults.recovery_states?.[0]?.id ?? null,
    adherence: defaults.adherence_levels?.[0]?.id ?? null,
    resources: [],
  };
}

function hydrateMetricSelections() {
  state.metricSelections = new Map();
  const stored = readStoredJSON(STORAGE_KEYS.metrics);
  if (!stored || typeof stored !== 'object') return;
  Object.entries(stored).forEach(([objectiveId, payload]) => {
    if (!objectiveId) return;
    if (!payload || typeof payload !== 'object') return;
    const entry = {
      metricId: typeof payload.metricId === 'string' ? payload.metricId : null,
      value: toNumber(payload.value, null),
    };
    if (!entry.metricId) return;
    state.metricSelections.set(objectiveId, entry);
  });
}

function persistMetricSelections() {
  const serialized = {};
  state.metricSelections.forEach((entry, objectiveId) => {
    serialized[objectiveId] = { metricId: entry.metricId, value: entry.value };
  });
  writeStoredJSON(STORAGE_KEYS.metrics, serialized);
}

function readStoredJSON(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStoredJSON(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

function initProfileTriggers() {
  document.querySelectorAll(PROFILE_TRIGGER_SELECTOR).forEach((element) => {
    element.addEventListener('click', () => openProfileModal());
  });
}

function buildProfileForm() {
  const defaults = state.userProfileDefaults;
  const form = document.getElementById('user-profile-form');
  if (!defaults || !form) return;

  populateProfileBasics(defaults);
  populateExperienceFields(defaults);
  populateRadioGroup(defaults.recovery_states, {
    containerId: 'profile-recovery-fields',
    name: 'recovery_state',
    title: 'Estado de recuperación',
  });
  populateRadioGroup(defaults.adherence_levels, {
    containerId: 'profile-adherence-fields',
    name: 'adherence',
    title: 'Adherencia prevista',
  });
  populateResourceTags(defaults.resource_options);

  form.addEventListener('submit', handleProfileSubmit);
  document.querySelectorAll('[data-profile-dismiss]').forEach((element) => {
    element.addEventListener('click', () => closeProfileModal());
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeProfileModal();
    }
  });
}

function populateProfileBasics(defaults) {
  const container = document.getElementById('profile-basics-fields');
  if (!container) return;
  container.innerHTML = '';
  const profile = state.userProfile ?? {};

  container.append(
    createNumberField({
      id: 'profile-age',
      name: 'age',
      label: 'Edad',
      min: defaults.age_range?.min,
      max: defaults.age_range?.max,
      value: profile.age,
      step: 1,
      unit: 'años',
    }),
    createSelectField({
      id: 'profile-gender',
      name: 'gender',
      label: 'Género',
      value: profile.gender,
      options: (defaults.genders ?? []).map((entry) => ({ value: entry.id, label: entry.label })),
    }),
    createNumberField({
      id: 'profile-weight',
      name: 'weight',
      label: 'Peso',
      min: defaults.weight_range?.min,
      max: defaults.weight_range?.max,
      value: profile.weight,
      step: 0.5,
      unit: defaults.weight_range?.unit ?? 'kg',
    }),
    createNumberField({
      id: 'profile-height',
      name: 'height',
      label: 'Altura',
      min: defaults.height_range?.min,
      max: defaults.height_range?.max,
      value: profile.height,
      step: 1,
      unit: defaults.height_range?.unit ?? 'cm',
    })
  );
}

function populateExperienceFields(defaults) {
  const container = document.getElementById('profile-experience-fields');
  if (!container) return;
  container.innerHTML = '';
  const profile = state.userProfile ?? {};
  const experienceLevels = defaults.experience_levels ?? {};

  (defaults.disciplines ?? []).forEach((discipline) => {
    if (!discipline?.id) return;
    const field = document.createElement('div');
    field.className = 'profile-form__field';

    const label = document.createElement('label');
    label.className = 'profile-form__label';
    label.setAttribute('for', `experience-${discipline.id}`);
    label.textContent = discipline.label ?? discipline.id;

    const select = document.createElement('select');
    select.id = `experience-${discipline.id}`;
    select.name = `experience_${discipline.id}`;
    select.className = 'profile-form__input';

    const optionsList = Array.isArray(discipline.experience_options)
      ? discipline.experience_options
      : Object.keys(experienceLevels);

    optionsList.forEach((value) => {
      if (!value) return;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = experienceLevels[value]?.label ?? value;
      select.append(option);
    });

    select.value = profile.experience?.[discipline.id] ?? defaults.default_experience ?? select.value;

    const hint = document.createElement('p');
    hint.className = 'profile-form__hint';
    const description = experienceLevels[select.value]?.description;
    hint.textContent = description ?? 'Selecciona la opción que mejor describe tu experiencia.';

    select.addEventListener('change', () => {
      const selectedDescription = experienceLevels[select.value]?.description;
      hint.textContent = selectedDescription ?? '';
    });

    field.append(label, select, hint);
    container.append(field);
  });
}

function populateRadioGroup(options, config) {
  const container = document.getElementById(config.containerId);
  if (!container) return;
  container.innerHTML = '';
  const profile = state.userProfile ?? {};
  const field = document.createElement('div');
  field.className = 'profile-form__field';

  const title = document.createElement('span');
  title.className = 'profile-form__label';
  title.textContent = config.title;
  field.append(title);

  const grid = document.createElement('div');
  grid.className = 'profile-form__grid';

  (options ?? []).forEach((option) => {
    if (!option?.id) return;
    const label = document.createElement('label');
    label.className = 'profile-form__option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = config.name;
    input.value = option.id;
    input.checked = (profile[config.name] ?? null) === option.id;

    const textWrapper = document.createElement('div');
    const titleSpan = document.createElement('span');
    titleSpan.textContent = option.label ?? option.id;
    textWrapper.append(titleSpan);
    if (option.description) {
      const description = document.createElement('small');
      description.textContent = option.description;
      textWrapper.append(description);
    }

    label.append(input, textWrapper);
    grid.append(label);
  });

  field.append(grid);
  container.append(field);
}

function populateResourceTags(options) {
  const container = document.getElementById('profile-resources-fields');
  if (!container) return;
  container.innerHTML = '';
  const profile = state.userProfile ?? {};

  (options ?? []).forEach((option) => {
    if (!option?.id) return;
    const label = document.createElement('label');
    label.className = 'profile-form__tag';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'resources';
    input.value = option.id;
    input.checked = Array.isArray(profile.resources) ? profile.resources.includes(option.id) : false;

    if (input.checked) {
      label.classList.add('is-active');
    }

    input.addEventListener('change', () => {
      label.classList.toggle('is-active', input.checked);
    });

    const textWrapper = document.createElement('div');
    const title = document.createElement('span');
    title.textContent = option.label ?? option.id;
    textWrapper.append(title);
    if (option.description) {
      const description = document.createElement('small');
      description.textContent = option.description;
      textWrapper.append(description);
    }

    label.append(input, textWrapper);
    container.append(label);
  });
}

function createNumberField({ id, name, label, min, max, step, value, unit }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'profile-form__field';

  const title = document.createElement('label');
  title.className = 'profile-form__label';
  title.setAttribute('for', id);
  title.textContent = label;

  const input = document.createElement('input');
  input.id = id;
  input.name = name;
  input.type = 'number';
  input.className = 'profile-form__input';
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  if (step !== undefined) input.step = step;
  if (Number.isFinite(value)) {
    input.value = value;
  }

  const hint = document.createElement('p');
  hint.className = 'profile-form__hint';
  hint.textContent = unit ? `Valor en ${unit}.` : '';

  wrapper.append(title, input, hint);
  return wrapper;
}

function createSelectField({ id, name, label, options, value }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'profile-form__field';
  const title = document.createElement('label');
  title.className = 'profile-form__label';
  title.setAttribute('for', id);
  title.textContent = label;
  const select = document.createElement('select');
  select.id = id;
  select.name = name;
  select.className = 'profile-form__input';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecciona una opción';
  placeholder.disabled = true;
  select.append(placeholder);

  (options ?? []).forEach((option) => {
    if (!option?.value) return;
    const optionElement = document.createElement('option');
    optionElement.value = option.value;
    optionElement.textContent = option.label ?? option.value;
    select.append(optionElement);
  });

  if (value) {
    select.value = value;
  }

  wrapper.append(title, select);
  return wrapper;
}

function handleProfileSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = document.getElementById('profile-modal-feedback');
  if (feedback) {
    feedback.textContent = '';
    feedback.style.color = 'var(--color-danger)';
  }
  const formData = new FormData(form);
  const profile = createEmptyProfile();

  profile.age = toNumber(formData.get('age'), null);
  profile.gender = formData.get('gender') || null;
  profile.weight = toNumber(formData.get('weight'), null);
  profile.height = toNumber(formData.get('height'), null);
  profile.recovery_state = formData.get('recovery_state') || null;
  profile.adherence = formData.get('adherence') || null;
  profile.resources = formData.getAll('resources').filter((value) => typeof value === 'string');

  Object.keys(profile.experience).forEach((disciplineId) => {
    const key = `experience_${disciplineId}`;
    const value = formData.get(key);
    if (typeof value === 'string' && value.trim()) {
      profile.experience[disciplineId] = value;
    }
  });

  const validation = validateUserProfile(profile);
  if (!validation.valid) {
    if (feedback) {
      feedback.textContent = validation.message;
    }
    return;
  }

  state.userProfile = profile;
  persistUserProfile();
  updateProfileEntryStatus();
  renderProgressPlanner();
  showSelectionMessage('Perfil guardado correctamente.', 'info');
  closeProfileModal(true);
}

function validateUserProfile(profile) {
  if (!profile) {
    return { valid: false, message: 'Completa tu perfil antes de guardar.' };
  }
  const numericFields = [
    ['age', 'Indica tu edad.'],
    ['weight', 'Indica tu peso actual.'],
    ['height', 'Indica tu altura.'],
  ];
  for (const [key, message] of numericFields) {
    if (!Number.isFinite(profile[key])) {
      return { valid: false, message };
    }
  }

  if (!profile.gender) {
    return { valid: false, message: 'Selecciona tu género.' };
  }

  if (!profile.recovery_state) {
    return { valid: false, message: 'Selecciona tu estado de recuperación.' };
  }

  if (!profile.adherence) {
    return { valid: false, message: 'Define tu adherencia prevista.' };
  }

  const experienceEntries = Object.entries(profile.experience ?? {});
  if (!experienceEntries.length || experienceEntries.some(([, value]) => !value)) {
    return { valid: false, message: 'Selecciona la experiencia en todas las disciplinas.' };
  }

  return { valid: true };
}

function persistUserProfile() {
  writeStoredJSON(STORAGE_KEYS.profile, state.userProfile);
}

function openProfileModal() {
  const modal = document.getElementById('user-profile-modal');
  if (!modal || modal.classList.contains('is-open')) return;
  state.profileModalPreviousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  const focusTarget = modal.querySelector('input, select, button:not([data-profile-dismiss])');
  if (focusTarget instanceof HTMLElement) {
    focusTarget.focus();
  }
}

function closeProfileModal(focusRestore = false) {
  const modal = document.getElementById('user-profile-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (focusRestore && state.profileModalPreviousFocus instanceof HTMLElement) {
    state.profileModalPreviousFocus.focus();
  }
  state.profileModalPreviousFocus = null;
}

function updateProfileEntryStatus() {
  const statusElement = document.getElementById('profile-entry-status');
  if (!statusElement) return;
  if (!isProfileComplete()) {
    statusElement.textContent = 'Completar';
    return;
  }
  const profile = state.userProfile;
  const agePart = Number.isFinite(profile?.age) ? `${profile.age} años` : null;
  const genderPart = resolveGenderLabel(profile?.gender);
  statusElement.textContent = [agePart, genderPart].filter(Boolean).join(' · ') || 'Listo';
}

function resolveGenderLabel(genderId) {
  const defaults = state.userProfileDefaults;
  if (!defaults) return null;
  const match = (defaults.genders ?? []).find((entry) => entry.id === genderId);
  return match?.label ?? null;
}

function isProfileComplete(profile = state.userProfile) {
  if (!profile) return false;
  const numericComplete =
    Number.isFinite(profile.age) && Number.isFinite(profile.weight) && Number.isFinite(profile.height);
  if (!numericComplete) return false;
  if (!profile.gender || !profile.recovery_state || !profile.adherence) {
    return false;
  }
  const experienceEntries = Object.entries(profile.experience ?? {});
  if (!experienceEntries.length) return false;
  if (experienceEntries.some(([, value]) => !value)) {
    return false;
  }
  return true;
}

function initProgressPlannerView() {
  const cta = document.getElementById('open-progress-planner');
  if (cta) {
    cta.addEventListener('click', () => {
      if (!ensureProfileBeforeProgress()) {
        return;
      }
      toggleProgressPlanner(true);
    });
  }

  const backButton = document.getElementById('progress-planner-back');
  if (backButton) {
    backButton.addEventListener('click', () => toggleProgressPlanner(false));
  }
}

function ensureProfileBeforeProgress() {
  if (isProfileComplete()) {
    return true;
  }
  showSelectionMessage('Completa tu perfil para usar el Progress Planner.', 'warning');
  openProfileModal();
  return false;
}

function toggleProgressPlanner(show) {
  const classic = document.getElementById('classic-planner-view');
  const progress = document.getElementById('progress-planner-view');
  if (!classic || !progress) return;
  if (show) {
    classic.classList.add('is-hidden');
    progress.classList.remove('is-hidden');
  } else {
    classic.classList.remove('is-hidden');
    progress.classList.add('is-hidden');
  }
  state.isProgressPlannerActive = show;
}

function renderProgressPlanner(options = {}) {
  const { skipMetricCards = false } = options;
  syncMetricSelectionsWithSelection();
  updateProgressSummaryCards();
  if (!skipMetricCards) {
    renderMetricSelectionCards();
    renderSelectedObjectivesList();
  }
  renderProjectionOutputs();
}

function syncMetricSelectionsWithSelection() {
  let changed = false;
  const selectedIds = new Set(state.selected);
  Array.from(state.metricSelections.keys()).forEach((objectiveId) => {
    if (!selectedIds.has(objectiveId)) {
      state.metricSelections.delete(objectiveId);
      changed = true;
    }
  });

  selectedIds.forEach((objectiveId) => {
    if (state.metricSelections.has(objectiveId)) return;
    const metrics = getMetricsForObjective(objectiveId);
    if (!metrics.length) return;
    const defaultMetric = metrics.find((metric) => typeof metric.default === 'number') ?? metrics[0];
    state.metricSelections.set(objectiveId, {
      metricId: defaultMetric?.id ?? null,
      value: typeof defaultMetric?.default === 'number' ? defaultMetric.default : null,
    });
    changed = true;
  });

  if (changed) {
    persistMetricSelections();
  }
}

function getMetricsForObjective(objectiveId) {
  const metrics = state.objectiveMetrics.get(objectiveId);
  if (!Array.isArray(metrics)) {
    return [];
  }
  return metrics;
}

function renderMetricSelectionCards() {
  const container = document.getElementById('metric-selection-grid');
  if (!container) return;
  container.innerHTML = '';
  const selectionIds = Array.from(state.selected);
  if (!selectionIds.length) {
    container.innerHTML =
      '<p class="empty-state">Selecciona objetivos para elegir las métricas que seguirás.</p>';
    return;
  }

  for (const objectiveId of selectionIds) {
    const objective = state.objectiveIndex.get(objectiveId);
    const metrics = getMetricsForObjective(objectiveId);
    const card = document.createElement('article');
    card.className = 'metric-card';

    const header = document.createElement('div');
    header.className = 'metric-card__header';

    const headingWrapper = document.createElement('div');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'metric-card__eyebrow';
    eyebrow.textContent = 'Objetivo';
    const title = document.createElement('h4');
    title.textContent = objective?.title ?? objectiveId;
    headingWrapper.append(eyebrow, title);

    const selection = state.metricSelections.get(objectiveId);
    const metricConfig = metrics.find((metric) => metric.id === selection?.metricId) ?? metrics[0];

    const pill = document.createElement('span');
    pill.className = 'metric-card__pill';
    pill.textContent = formatDisciplineLabel(metricConfig?.discipline) ?? 'Sin disciplina';

    header.append(headingWrapper, pill);
    card.append(header);

    if (!metrics.length) {
      const warning = document.createElement('p');
      warning.className = 'metric-card__meta';
      warning.textContent = 'No hay métricas configuradas para este objetivo.';
      card.append(warning);
      container.append(card);
      continue;
    }

    const selectField = document.createElement('label');
    selectField.className = 'metric-card__field';
    selectField.textContent = 'Métrica a seguir';
    const select = document.createElement('select');
    select.className = 'profile-form__input';
    select.dataset.objectiveId = objectiveId;

    metrics.forEach((metric) => {
      const option = document.createElement('option');
      option.value = metric.id;
      option.textContent = metric.label;
      select.append(option);
    });

    if (selection?.metricId) {
      select.value = selection.metricId;
    }

    select.addEventListener('change', () => handleMetricSelectChange(objectiveId, select.value));
    selectField.append(select);
    card.append(selectField);

    const valueField = document.createElement('label');
    valueField.className = 'metric-card__field';
    valueField.textContent = 'Valor actual';

    const valueWrapper = document.createElement('div');
    valueWrapper.className = 'metric-card__value-input';

    const valueInput = document.createElement('input');
    valueInput.type = 'number';
    valueInput.step = '0.01';
    valueInput.placeholder = 'Ingresa un número';
    if (Number.isFinite(selection?.value)) {
      valueInput.value = selection.value;
    }
    valueInput.addEventListener('input', (event) => {
      const numericValue = Number.parseFloat(event.target.value);
      handleMetricValueInput(objectiveId, Number.isFinite(numericValue) ? numericValue : null);
    });

    const unit = document.createElement('span');
    unit.className = 'metric-card__unit';
    unit.textContent = metricConfig?.unit ?? '';

    valueWrapper.append(valueInput, unit);
    valueField.append(valueWrapper);
    card.append(valueField);

    if (metricConfig?.description) {
      const description = document.createElement('p');
      description.className = 'metric-card__meta';
      description.textContent = metricConfig.description;
      card.append(description);
    }

    container.append(card);
  }
}

function handleMetricSelectChange(objectiveId, metricId) {
  if (!state.metricSelections.has(objectiveId)) return;
  const metrics = getMetricsForObjective(objectiveId);
  const metricConfig = metrics.find((metric) => metric.id === metricId);
  if (!metricConfig) return;
  const current = state.metricSelections.get(objectiveId) ?? {};
  state.metricSelections.set(objectiveId, {
    metricId,
    value:
      typeof metricConfig.default === 'number'
        ? metricConfig.default
        : Number.isFinite(current.value)
        ? current.value
        : null,
  });
  persistMetricSelections();
  renderProgressPlanner();
}

function handleMetricValueInput(objectiveId, value) {
  if (!state.metricSelections.has(objectiveId)) return;
  const entry = state.metricSelections.get(objectiveId);
  entry.value = value;
  state.metricSelections.set(objectiveId, entry);
  persistMetricSelections();
  renderProgressPlanner({ skipMetricCards: true });
}

function renderSelectedObjectivesList() {
  const container = document.getElementById('progress-selected-list');
  if (!container) return;
  const selectionIds = Array.from(state.selected);
  if (!selectionIds.length) {
    container.textContent = 'No hay objetivos activos en esta sesión.';
    return;
  }

  const fragments = selectionIds.map((objectiveId) => {
    const objective = state.objectiveIndex.get(objectiveId);
    const selection = state.metricSelections.get(objectiveId);
    const metrics = getMetricsForObjective(objectiveId);
    const metricConfig = metrics.find((metric) => metric.id === selection?.metricId);
    const metricLabel = metricConfig?.label ?? 'Sin métrica';
    const currentValue =
      Number.isFinite(selection?.value) && metricConfig
        ? `${selection.value} ${metricConfig.unit ?? ''}`.trim()
        : 'Sin valor registrado';
    return `<p><strong>${objective?.title ?? objectiveId}</strong> · ${metricLabel} (${currentValue})</p>`;
  });

  container.innerHTML = fragments.join('');
}

function updateProgressSummaryCards() {
  const adherenceValue = document.getElementById('summary-adherence-value');
  const adherenceNote = document.getElementById('summary-adherence-note');
  const availabilityValue = document.getElementById('summary-availability-value');
  const availabilityNote = document.getElementById('summary-availability-note');
  const recoveryValue = document.getElementById('summary-recovery-value');
  const recoveryNote = document.getElementById('summary-recovery-note');
  const interferenceValue = document.getElementById('summary-interference-value');
  const interferenceNote = document.getElementById('summary-interference-note');
  const resourcesValue = document.getElementById('summary-resources-value');
  const resourcesNote = document.getElementById('summary-resources-note');

  if (!isProfileComplete()) {
    if (adherenceValue) adherenceValue.textContent = '—';
    if (adherenceNote) adherenceNote.textContent = 'Completa tu perfil para estimar adherencia.';
    if (recoveryValue) recoveryValue.textContent = '—';
    if (recoveryNote) recoveryNote.textContent = 'Indica cómo estás recuperando.';
  } else {
    const defaults = state.userProfileDefaults ?? {};
    const adherenceEntry = (defaults.adherence_levels ?? []).find(
      (item) => item.id === state.userProfile?.adherence
    );
    if (adherenceValue) {
      adherenceValue.textContent = adherenceEntry?.label ?? '—';
    }
    if (adherenceNote) {
      adherenceNote.textContent =
        adherenceEntry?.description ?? 'Estimación de sesiones que puedes sostener.';
    }

    const recoveryEntry = (defaults.recovery_states ?? []).find(
      (item) => item.id === state.userProfile?.recovery_state
    );
    if (recoveryValue) {
      recoveryValue.textContent = recoveryEntry?.label ?? '—';
    }
    if (recoveryNote) {
      recoveryNote.textContent =
        recoveryEntry?.description ?? 'Describe cómo llega tu sistema nervioso a la semana.';
    }
  }

  const totals = state.weeklyTotals ?? { totalMinutes: 0, availability: state.availability };
  if (!state.selected.size) {
    if (availabilityValue) availabilityValue.textContent = '—';
    if (availabilityNote) availabilityNote.textContent = 'Selecciona objetivos para estimar carga.';
  } else if (!totals.availability) {
    if (availabilityValue) availabilityValue.textContent = '—';
    if (availabilityNote) availabilityNote.textContent = 'Define tu disponibilidad semanal.';
  } else {
    const ratio = totals.totalMinutes ? totals.availability / totals.totalMinutes : 0;
    const formattedRatio = Number.isFinite(ratio) && ratio > 0 ? `${ratio.toFixed(2)}×` : '—';
    if (availabilityValue) availabilityValue.textContent = formattedRatio;
    if (availabilityNote) {
      if (!totals.totalMinutes) {
        availabilityNote.textContent = 'Selecciona objetivos para estimar el mínimo necesario.';
      } else if (ratio >= 1.15) {
        availabilityNote.textContent = 'Aún tienes colchón para añadir accesorios o trabajo técnico.';
      } else if (ratio >= 1) {
        availabilityNote.textContent = 'Estás justo en tu disponibilidad semanal. Prioriza la calidad.';
      } else {
        const deficit = formatMinutes(totals.totalMinutes - totals.availability, {
          threshold: DISPLAY_MINUTE_THRESHOLD,
        });
        availabilityNote.textContent = `Necesitas liberar ~${deficit} para cuadrar tu semana.`;
      }
    }
  }

  if (interferenceValue) {
    const score = typeof state.latestInterference?.score === 'number' ? state.latestInterference.score : null;
    interferenceValue.textContent = score !== null ? `${Math.round(score * 100)}%` : '—';
  }
  if (interferenceNote) {
    if (!state.selected.size) {
      interferenceNote.textContent = 'Añade objetivos para evaluar la interferencia.';
    } else if (state.selected.size === 1) {
      interferenceNote.textContent = 'Necesitas al menos dos objetivos para este análisis.';
    } else if (state.latestInterferenceInsights) {
      interferenceNote.textContent = state.latestInterferenceInsights.summary;
    } else {
      interferenceNote.textContent = 'No pudimos calcular la interferencia para esta combinación.';
    }
  }

  if (resourcesValue) {
    const count = Array.isArray(state.userProfile?.resources) ? state.userProfile.resources.length : 0;
    resourcesValue.textContent = count ? `${count} activos` : 'Sin extras';
  }
  if (resourcesNote) {
    resourcesNote.textContent =
      'Indica qué equipamiento o espacios tienes disponibles para ajustar la progresión.';
  }
}

function formatDisciplineLabel(disciplineId) {
  if (!disciplineId) return null;
  const defaults = state.userProfileDefaults;
  const discipline = (defaults?.disciplines ?? []).find((entry) => entry.id === disciplineId);
  return discipline?.label ?? disciplineId;
}

function renderProjectionOutputs() {
  const statusElement = document.getElementById('projection-panel-status');
  const emptyState = document.getElementById('projection-chart-empty');
  const readiness = getMetricReadiness();

  let statusMessage = '';
  let showEmptyState = true;

  if (!state.selected.size) {
    statusMessage = 'Selecciona al menos un objetivo para generar la proyección.';
    updateProjectionChart([]);
    updateProjectionSummaryList([]);
    renderProjectionInterferenceList();
  } else if (!isProfileComplete()) {
    statusMessage = 'Completa tu perfil para estimar la evolución.';
    updateProjectionChart([]);
    updateProjectionSummaryList([]);
    renderProjectionInterferenceList();
  } else if (!readiness.ready) {
    statusMessage = readiness.message;
    updateProjectionChart([]);
    updateProjectionSummaryList([]);
    renderProjectionInterferenceList();
  } else {
    const { datasets, summaries } = buildProjectionDatasets();
    if (!datasets.length) {
      statusMessage =
        'Registra al menos un valor actual en las métricas para visualizar la proyección de 12 semanas.';
      updateProjectionChart([]);
      updateProjectionSummaryList([]);
      renderProjectionInterferenceList();
    } else {
      statusMessage = 'Proyección actualizada combinando tu perfil, recursos e interferencia actual.';
      updateProjectionChart(datasets);
      updateProjectionSummaryList(summaries);
      renderProjectionInterferenceList();
      showEmptyState = false;
    }
  }

  if (emptyState) {
    emptyState.style.display = showEmptyState ? 'grid' : 'none';
  }
  if (statusElement) {
    statusElement.textContent = statusMessage;
  }
}

function getMetricReadiness() {
  const selectionIds = Array.from(state.selected);
  if (!selectionIds.length) {
    return { ready: false, message: 'Selecciona objetivos para comenzar.' };
  }

  for (const objectiveId of selectionIds) {
    const metrics = getMetricsForObjective(objectiveId);
    if (!metrics.length) {
      const objective = state.objectiveIndex.get(objectiveId);
      return {
        ready: false,
        message: `Aún no hay métricas definidas para “${objective?.title ?? objectiveId}”.`,
      };
    }
    if (!state.metricSelections.has(objectiveId)) {
      return { ready: false, message: 'Selecciona la métrica que vas a seguir para cada objetivo.' };
    }
  }

  const hasValue = selectionIds.some((objectiveId) => Number.isFinite(state.metricSelections.get(objectiveId)?.value));
  if (!hasValue) {
    return { ready: false, message: 'Registra tu valor actual para al menos una métrica.' };
  }

  return { ready: true };
}

function buildProjectionDatasets() {
  const datasets = [];
  const summaries = [];
  const labels = getProjectionLabels();

  state.metricSelections.forEach((selection, objectiveId) => {
    if (!state.selected.has(objectiveId)) return;
    const metrics = getMetricsForObjective(objectiveId);
    const metricConfig = metrics.find((metric) => metric.id === selection.metricId);
    if (!metricConfig || !Number.isFinite(selection.value)) return;

    const projection = computeMetricProjection(metricConfig, selection.value);
    if (!projection) return;

    const objective = state.objectiveIndex.get(objectiveId);
    const color =
      metricConfig.color ||
      state.progressionRates.get(metricConfig.discipline)?.color ||
      'rgba(96, 165, 250, 1)';

    datasets.push({
      label: `${objective?.title ?? objectiveId} · ${metricConfig.label}`,
      data: projection.relativeSeries,
      borderColor: color,
      backgroundColor: color.replace('1)', '0.2)').replace('rgb', 'rgba'),
      borderWidth: 2.5,
      tension: 0.5,
      fill: false,
      unit: metricConfig.unit,
      metaValues: projection.actualSeries,
    });

    summaries.push({
      label: `${metricConfig.label} (${objective?.title ?? objectiveId})`,
      percent: projection.relativeSeries[projection.relativeSeries.length - 1],
      absolute: projection.actualSeries[projection.actualSeries.length - 1],
      unit: metricConfig.unit,
    });
  });

  return { datasets: datasets.map((dataset) => ({ ...dataset, labels })), summaries };
}

function computeMetricProjection(metricConfig, currentValue) {
  if (!Number.isFinite(currentValue) || currentValue === 0) {
    return null;
  }
  const baseRate = resolveProgressionRate(metricConfig.discipline);
  const modifier = computeProfileModifier(metricConfig.discipline);
  const adjustedRate = clampProgressRate(baseRate * modifier);
  const trend = (metricConfig.trend ?? 'increase').toLowerCase();

  // Calcular ganancia máxima esperada en 12 semanas (usando la tasa ajustada)
  // Multiplicamos por 12 para obtener el total teórico, pero luego aplicamos curva
  const maxGainLinear = adjustedRate * PROJECTION_WEEKS;
  
  // Factor de saturación: controla qué tan rápido se aplana la curva
  // Valores más altos = más rápido se aplana (más realista para avanzados)
  // Valores más bajos = más lineal (más para principiantes)
  // Aumentados para generar curvas más visibles y pronunciadas
  const experienceId = state.userProfile?.experience?.[metricConfig.discipline] ?? 'intermediate';
  const saturationFactor = experienceId === 'novice' ? 0.4 : experienceId === 'intermediate' ? 0.5 : 0.65;
  
  const relativeSeries = [];
  const actualSeries = [];

  for (let week = 0; week <= PROJECTION_WEEKS; week += 1) {
    let value = currentValue;
    let relativeDelta = 0;

    if (trend === 'decrease') {
      // Para métricas que mejoran al disminuir (tiempos, % grasa, etc.)
      // Usamos curva exponencial inversa con ajuste de curvatura: mejora rápida al inicio, luego se aplana
      const normalizedWeek = week / PROJECTION_WEEKS;
      // Combinamos exponencial con función de potencia para más curvatura visible
      const progressRatio = 1 - Math.exp(-saturationFactor * week * (1 + normalizedWeek * 0.5));
      const maxReduction = Math.min(maxGainLinear * 0.8, 0.4); // Máximo 40% de reducción
      const reduction = maxReduction * progressRatio;
      value = currentValue * (1 - reduction);
      // Límite mínimo: no reducir más del 50% del valor original
      value = Math.max(value, currentValue * 0.5);
      relativeDelta = ((currentValue - value) / currentValue) * 100;
    } else if (trend === 'stable') {
      // Para mantenimiento: pequeña oscilación controlada
      const sway = Math.min(adjustedRate * 0.15, 0.02);
      const oscillation = Math.sin((week / PROJECTION_WEEKS) * Math.PI * 2) * sway;
      value = currentValue * (1 + oscillation);
      relativeDelta = ((value - currentValue) / currentValue) * 100;
    } else {
      // Para métricas que mejoran al aumentar (fuerza, masa, VO2max, etc.)
      // Curva de saturación exponencial con ajuste de curvatura: ganancias rápidas al inicio, luego se aplana
      const normalizedWeek = week / PROJECTION_WEEKS;
      // Combinamos exponencial con función de potencia para más curvatura visible al inicio
      // El factor (1 + normalizedWeek * 0.5) hace que la curva sea más pronunciada al inicio
      const progressRatio = 1 - Math.exp(-saturationFactor * week * (1 + normalizedWeek * 0.5));
      // Ajustamos la ganancia máxima para que sea realista (no más del 50% en 12 semanas)
      const maxGain = Math.min(maxGainLinear * 0.9, 0.5);
      const gain = maxGain * progressRatio;
      value = currentValue * (1 + gain);
      relativeDelta = ((value - currentValue) / currentValue) * 100;
    }

    relativeSeries.push(Number(relativeDelta.toFixed(2)));
    actualSeries.push(Number(value.toFixed(2)));
  }

  return { relativeSeries, actualSeries };
}

function resolveProgressionRate(discipline) {
  const entry = state.progressionRates.get(discipline);
  if (!entry) {
    return 0.02;
  }
  const baseRates = entry.base_rates ?? {};
  const experienceId = state.userProfile?.experience?.[discipline] ?? state.userProfileDefaults?.default_experience;
  if (experienceId && Number.isFinite(baseRates[experienceId])) {
    return Number(baseRates[experienceId]);
  }
  return averageRateEntry(baseRates);
}

function averageRateEntry(baseRates) {
  const values = Object.values(baseRates ?? {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    return 0.02;
  }
  const total = values.reduce((acc, value) => acc + value, 0);
  return total / values.length;
}

function computeProfileModifier(discipline) {
  const defaults = state.userProfileDefaults ?? {};
  const profile = state.userProfile ?? {};
  const adherenceModifier =
    resolveModifier(defaults.adherence_levels, profile.adherence) ?? 1;
  const recoveryModifier = resolveModifier(defaults.recovery_states, profile.recovery_state) ?? 1;
  const resourceModifier = 1 + computeResourceModifier();
  const availabilityModifier = computeAvailabilityModifier();
  const interferenceModifier = computeInterferenceModifier(discipline);
  return adherenceModifier * recoveryModifier * resourceModifier * availabilityModifier * interferenceModifier;
}

function resolveModifier(options, selectedId) {
  if (!Array.isArray(options) || !selectedId) return null;
  const match = options.find((option) => option.id === selectedId);
  return Number.isFinite(match?.modifier) ? Number(match.modifier) : null;
}

function computeResourceModifier() {
  const defaults = state.userProfileDefaults;
  if (!defaults || !Array.isArray(defaults.resource_options)) return 0;
  const map = new Map(defaults.resource_options.map((option) => [option.id, Number(option.modifier) || 0]));
  const resources = Array.isArray(state.userProfile?.resources) ? state.userProfile.resources : [];
  const total = resources.reduce((acc, resourceId) => acc + (map.get(resourceId) ?? 0), 0);
  return Math.min(0.2, Math.max(0, total));
}

function computeAvailabilityModifier() {
  const totals = state.weeklyTotals ?? { totalMinutes: 0, availability: state.availability };
  const availability = totals.availability || 0;
  const required = totals.totalMinutes || 0;
  if (!availability || !required) {
    return 1;
  }
  const ratio = availability / required;
  if (ratio >= 1.25) return 1.08;
  if (ratio >= 1.1) return 1.04;
  if (ratio >= 1) return 1;
  if (ratio >= 0.9) return 0.92;
  return Math.max(0.65, ratio);
}

function computeInterferenceModifier(discipline) {
  if (!discipline || !state.latestInterference) {
    return 1;
  }
  const mapping = state.disciplineInterferenceMatrix.get(discipline);
  if (!mapping) {
    return 1 - clamp01(state.latestInterference.score ?? 0) * 0.4;
  }
  const score = clamp01(state.latestInterference.score ?? 0);
  const breakdown = Array.isArray(state.latestInterference.breakdown)
    ? state.latestInterference.breakdown
    : [];
  let axisPenalty = 0;
  let axisWeight = 0;
  breakdown.forEach((entry) => {
    const axis = entry?.axis;
    if (!axis || !mapping.axes?.[axis]) return;
    axisWeight += mapping.axes[axis];
    axisPenalty += mapping.axes[axis] * clamp01(entry.interference ?? entry.contribution ?? 0);
  });
  const normalizedAxisPenalty = axisWeight ? axisPenalty / axisWeight : score;
  const combined = mapping.base_weight * score + (1 - mapping.base_weight) * normalizedAxisPenalty;
  return Math.max(0.45, 1 - combined * 0.75);
}

function updateProjectionChart(datasets) {
  const ctx = document.getElementById('projectionChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const labels = getProjectionLabels();

  if (!state.projectionChart) {
    state.projectionChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            ticks: {
              callback: (value) => `${value}%`,
            },
            title: { display: true, text: '% vs valor actual' },
          },
          x: {
            ticks: { callback: (value, index) => (index === 0 ? 'Semana 0' : `Semana ${index}`) },
          },
        },
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label(context) {
                const dataset = context.dataset;
                const actual = dataset.metaValues?.[context.dataIndex];
                const percentage = Number(context.parsed.y).toFixed(2);
                const absoluteLabel = actual !== undefined ? ` · ${formatMetricValue(actual, dataset.unit)}` : '';
                return `${dataset.label}: ${percentage}%${absoluteLabel}`;
              },
            },
          },
        },
      },
    });
  }

  state.projectionChart.data.labels = labels;
  state.projectionChart.data.datasets = datasets.map((dataset) => ({
    ...dataset,
  }));
  state.projectionChart.update();
}

function getProjectionLabels() {
  return Array.from({ length: PROJECTION_WEEKS + 1 }, (_, index) =>
    index === 0 ? 'Semana 0' : `Semana ${index}`
  );
}

function updateProjectionSummaryList(entries) {
  const list = document.getElementById('projection-summary-list');
  if (!list) return;
  list.innerHTML = '';
  if (!entries.length) {
    const item = document.createElement('li');
    item.textContent = 'Registra valores para ver la proyección de cada métrica.';
    list.append(item);
    return;
  }

  entries.forEach((entry) => {
    const item = document.createElement('li');
    const change = entry.percent >= 0 ? `+${entry.percent.toFixed(1)}%` : `${entry.percent.toFixed(1)}%`;
    item.textContent = `${entry.label}: ${change} → ${formatMetricValue(entry.absolute, entry.unit)}`;
    list.append(item);
  });
}

function renderProjectionInterferenceList() {
  const list = document.getElementById('projection-interference-list');
  if (!list) return;
  list.innerHTML = '';

  const breakdown = Array.isArray(state.latestInterference?.breakdown)
    ? state.latestInterference.breakdown
    : [];
  if (!breakdown.length) {
    const item = document.createElement('li');
    item.textContent = 'Necesitas al menos dos objetivos para estimar la interferencia específica.';
    list.append(item);
    return;
  }

  const sorted = [...breakdown]
    .map((entry) => ({
      axis: entry.axis,
      impact: clamp01(entry.interference ?? entry.contribution ?? 0),
      label: formatInterferenceAxisLabel(entry.axis, entry.label),
      disciplines: getAxisDisciplineHighlights(entry.axis),
    }))
    .filter((entry) => entry.label)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3);

  sorted.forEach((entry) => {
    const item = document.createElement('li');
    const percent = Math.round(entry.impact * 100);
    const disciplines = entry.disciplines.length
      ? ` · Impacta más a ${entry.disciplines.join(', ')}`
      : '';
    item.textContent = `${entry.label}: ${percent}%${disciplines}`;
    list.append(item);
  });
}

function getAxisDisciplineHighlights(axisKey) {
  if (!axisKey || !state.disciplineInterferenceMatrix.size) {
    return [];
  }
  const matches = [];
  state.disciplineInterferenceMatrix.forEach((entry) => {
    const weight = entry.axes?.[axisKey];
    if (!weight) return;
    matches.push({ label: entry.label ?? entry.id, weight });
  });
  return matches
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((entry) => entry.label);
}

function formatMetricValue(value, unit) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const formatted = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
}

function clampProgressRate(value) {
  if (!Number.isFinite(value)) return 0.01;
  return Math.max(0.0025, Math.min(0.07, value));
}

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
