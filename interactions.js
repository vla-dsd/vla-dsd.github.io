(function () {
  "use strict";

  var STORY_DURATION_MS = 7000;
  var activeStory = null;
  var NORMALIZATION_AXIS_ORDER = ["x", "y", "z"];
  var NORMALIZATION_AXIS_DEFAULTS = {
    x: { action: 4, startLower: -4, startUpper: 9.9, targetLower: -0.5, targetUpper: 4.29, direction: 0.62, token: 207 },
    y: { action: 4, startLower: -5, startUpper: 11.2, targetLower: -0.2, targetUpper: 4.15, direction: 0.62, token: 207 },
    z: { action: 3, startLower: -3, startUpper: 10.6, targetLower: -1, targetUpper: 4, direction: 0.47, token: 187 }
  };
  var TRANSFER_SOURCE_ACTION = [2.90, -4.60, 3.40];
  var TRANSFER_ENCODED_ACTION = [0.109, -0.101, -0.110];
  var TRANSFER_BERKELEY_OUTPUT = [2.18, -2.02, -2.19];
  var TRANSFER_BERKELEY_ANGLE = 69.84;

  var reducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function smoothstep(value) {
    var t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function rangeFraction(input) {
    if (!input) return 0;
    var minimum = Number(input.min || 0);
    var maximum = Number(input.max || 100);
    var value = Number(input.value || minimum);
    return maximum === minimum ? 0 : clamp((value - minimum) / (maximum - minimum), 0, 1);
  }

  function setRangeFraction(input, fraction) {
    if (!input) return;
    var minimum = Number(input.min || 0);
    var maximum = Number(input.max || 100);
    input.value = String(lerp(minimum, maximum, clamp(fraction, 0, 1)));
  }

  function roleNodes(root, names) {
    var selectors = names.map(function (name) {
      return '[data-role="' + name + '"]';
    });
    return selectors.length ? Array.prototype.slice.call(root.querySelectorAll(selectors.join(","))) : [];
  }

  function setRoleText(root, names, value) {
    roleNodes(root, names).forEach(function (node) {
      node.textContent = value;
    });
  }

  function setButtonLabel(button, label) {
    if (!button) return;
    var labelNode = button.querySelector('[data-role="play-label"]');
    if (labelNode) labelNode.textContent = label;
    else {
      var icon = button.querySelector('[aria-hidden="true"]');
      if (icon) {
        var textNode = Array.prototype.slice.call(button.childNodes).find(function (node) {
          return node.nodeType === 3 && node.textContent.trim();
        });
        if (textNode) textNode.textContent = " " + label;
        else button.appendChild(document.createTextNode(" " + label));
      } else {
        button.textContent = label;
      }
    }
    button.setAttribute("aria-label", label + " animation");
  }

  function formatSigned(value, decimals) {
    return Number(value).toFixed(decimals).replace("-", "\u2212");
  }

  function formatVector(values) {
    return "(" + values.map(function (value) {
      return formatSigned(value, 2);
    }).join(", ") + ") mm";
  }

  function safePlay(video) {
    if (!video) return;
    var result;
    try {
      result = video.play();
    } catch (_error) {
      return;
    }
    if (result && typeof result.catch === "function") {
      result.catch(function () {
        // Browsers may decline media playback even after a user gesture.
      });
    }
  }

  function positionOnPath(marker, path, progress) {
    if (!marker || !path || typeof path.getTotalLength !== "function" || typeof path.getPointAtLength !== "function") {
      return;
    }

    try {
      var point = path.getPointAtLength(path.getTotalLength() * clamp(progress, 0, 1));
      var tag = String(marker.tagName || "").toLowerCase();
      if (tag === "circle" || tag === "ellipse") {
        marker.setAttribute("cx", String(point.x));
        marker.setAttribute("cy", String(point.y));
      } else {
        marker.setAttribute("transform", "translate(" + point.x + " " + point.y + ")");
      }
    } catch (_error) {
      // A malformed optional SVG path must not disable the rest of the page.
    }
  }

  function formatTokens(values) {
    return values.map(function (value) {
      return "#" + Math.round(clamp(value, 0, 255));
    }).join(" \u00b7 ");
  }

  function readNumeric(input, fallback) {
    if (!input) return fallback;
    var value = Number(input.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function readBound(input, fallback) {
    var value = readNumeric(input, fallback);
    return Math.abs(value) > 15 ? value / 10 : value;
  }

  function setBoundInput(input, value) {
    if (!input) return;
    var maximum = Math.max(Math.abs(Number(input.min || 0)), Math.abs(Number(input.max || 0)));
    input.value = String(maximum > 15 ? Math.round(value * 10) : value);
  }

  function formatUnitlessVector(values) {
    return "(" + values.map(function (value) {
      return formatSigned(value, 3);
    }).join(", ") + ")";
  }

  function vectorLength(vector) {
    return Math.sqrt(vector.reduce(function (sum, value) {
      return sum + value * value;
    }, 0));
  }

  function scaleVector(vector, scale) {
    return vector.map(function (value) { return value * scale; });
  }

  function vectorAngle(first, second) {
    var firstLength = vectorLength(first);
    var secondLength = vectorLength(second);
    if (firstLength < 1e-8 || secondLength < 1e-8) return 0;
    var dot = first.reduce(function (sum, value, index) {
      return sum + value * second[index];
    }, 0);
    return Math.acos(clamp(dot / (firstLength * secondLength), -1, 1)) * 180 / Math.PI;
  }

  function projectedEndpoint(vector, length, originX, originY) {
    // A compact oblique projection keeps all three axes visible without letting
    // the comparison arrows dominate the card.
    var horizontal = vector[0] - 0.55 * vector[1];
    var vertical = -vector[2] + 0.30 * vector[1];
    var projectedLength = Math.sqrt(horizontal * horizontal + vertical * vertical) || 1;
    return {
      x: originX + horizontal / projectedLength * length,
      y: originY + vertical / projectedLength * length
    };
  }

  function setLineEndpoint(line, vector, length) {
    if (!line) return;
    var originX = Number(line.getAttribute("x1")) || 0;
    var originY = Number(line.getAttribute("y1")) || 0;
    var point = projectedEndpoint(vector, length, originX, originY);
    line.setAttribute("x2", point.x.toFixed(2));
    line.setAttribute("y2", point.y.toFixed(2));
  }

  function setAngleArc(arc, source, target, radius) {
    if (!arc) return;
    var originX = 86;
    var originY = 192;
    var sourcePoint = projectedEndpoint(source, radius, originX, originY);
    var targetPoint = projectedEndpoint(target, radius, originX, originY);
    var sourceAngle = Math.atan2(sourcePoint.y - originY, sourcePoint.x - originX);
    var targetAngle = Math.atan2(targetPoint.y - originY, targetPoint.x - originX);
    var delta = targetAngle - sourceAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) < 0.01) {
      arc.setAttribute("d", "");
      return;
    }
    var sweep = delta >= 0 ? 1 : 0;
    arc.setAttribute(
      "d",
      "M" + sourcePoint.x.toFixed(2) + " " + sourcePoint.y.toFixed(2) +
      " A" + radius + " " + radius + " 0 0 " + sweep + " " +
      targetPoint.x.toFixed(2) + " " + targetPoint.y.toFixed(2)
    );
  }

  function renderSpeed(controller, progress) {
    var article = controller.article;
    var motionProgress = smoothstep(progress);
    var speedFactor = controller.speedFactor || 1.6;
    var effectiveFastSpeed = Math.max(1.05, speedFactor);
    var slowProgress = motionProgress;
    var fastProgress = clamp(motionProgress * effectiveFastSpeed, 0, 1);
    // The geometric path is straight, so this direction-token triplet remains
    // identical at every sample and at both collection speeds.
    // These three illustrative bins decode to an approximately unit-length
    // 3-D direction: (0.74, 0.18, 0.65).
    var directionTokens = [222, 151, 211];
    var direction = directionTokens.map(function (token) {
      return (token - 128) / 127;
    });

    function magnitudeAt(laneProgress, peakMagnitude) {
      // Smooth accelerate/decelerate profile with a small non-zero floor so
      // that the current action remains visible at both endpoints.
      return peakMagnitude * (0.18 + 0.82 * Math.sin(Math.PI * clamp(laneProgress, 0, 1)));
    }

    var slowMagnitude = magnitudeAt(slowProgress, 0.28);
    var fastMagnitude = magnitudeAt(fastProgress, 0.28 * effectiveFastSpeed);
    var slowRawTokens = direction.map(function (component) {
      return 128 + component * slowMagnitude * 195;
    });
    var fastRawTokens = direction.map(function (component) {
      return 128 + component * fastMagnitude * 195;
    });
    var slowScaleToken = Math.round(clamp(slowMagnitude / 0.55, 0, 1) * 255);
    var fastScaleToken = Math.round(clamp(fastMagnitude / 0.55, 0, 1) * 255);

    article.style.setProperty("--motion-progress", motionProgress.toFixed(4));
    article.style.setProperty("--slow-progress", slowProgress.toFixed(4));
    article.style.setProperty("--fast-progress", fastProgress.toFixed(4));
    article.style.setProperty("--speed-factor", speedFactor.toFixed(2));
    article.style.setProperty("--slow-step-scale", slowMagnitude.toFixed(3));
    article.style.setProperty("--fast-step-scale", fastMagnitude.toFixed(3));

    var slowMarker = article.querySelector('[data-role="speed-slow-marker"]');
    var fastMarker = article.querySelector('[data-role="speed-fast-marker"]');
    var slowPath = article.querySelector('[data-role="slow-path"]');
    var fastPath = article.querySelector('[data-role="fast-path"]') || slowPath;
    positionOnPath(slowMarker, slowPath, slowProgress);
    positionOnPath(fastMarker, fastPath, fastProgress);

    // These values never disappear: the current action token is visible for
    // every sample of the motion, including the initial frame.
    setRoleText(article, ["speed-raw-slow-token", "speed-slow-token", "slow-token"], formatTokens(slowRawTokens));
    setRoleText(article, ["speed-raw-fast-token", "speed-fast-token", "fast-token"], formatTokens(fastRawTokens));
    setRoleText(article, ["speed-dsd-direction-slow", "speed-dsd-direction-fast"], formatTokens(directionTokens));
    setRoleText(article, ["speed-dsd-scale-slow"], "scale #" + slowScaleToken);
    setRoleText(article, ["speed-dsd-scale-fast"], "scale #" + fastScaleToken);
    setRoleText(article, ["speed-slow-progress"], Math.round(slowProgress * 100) + "%");
    setRoleText(article, ["speed-fast-progress"], Math.round(fastProgress * 100) + "%");
    setRoleText(article, ["speed-fast-value", "speed-factor-value"], speedFactor.toFixed(1) + "\u00d7");
    article.dataset.directionTokenState = "constant";
    article.dataset.slowMagnitude = slowMagnitude.toFixed(4);
    article.dataset.fastMagnitude = fastMagnitude.toFixed(4);
  }

  function updateNormalizationAxisButtons(controller) {
    var selectedAxis = controller.normalizationAxis || "x";
    controller.normalizationAxisButtons.forEach(function (button) {
      var selected = button.dataset.normalizationAxis === selectedAxis;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.removeAttribute("aria-selected");
      button.tabIndex = selected ? 0 : -1;
      button.dataset.active = selected ? "true" : "false";
    });
  }

  function renderNormalization(controller, progress) {
    var article = controller.article;
    var mix = smoothstep(progress);
    var domainMinimum = -8;
    var domainMaximum = 14;
    var states = {};

    NORMALIZATION_AXIS_ORDER.forEach(function (axis) {
      var defaults = NORMALIZATION_AXIS_DEFAULTS[axis];
      var targets = controller.normalizationBounds[axis];
      var lower = lerp(defaults.startLower, targets.lower, mix);
      var upper = lerp(defaults.startUpper, targets.upper, mix);
      if (upper <= lower + 0.10) upper = lower + 0.10;

      var normalizedValue = clamp(2 * (defaults.action - lower) / (upper - lower) - 1, -1, 1);
      var bin = clamp(Math.floor(((normalizedValue + 1) / 2) * 256), 0, 255);
      var leftPosition = clamp((lower - domainMinimum) / (domainMaximum - domainMinimum) * 100, 0, 100);
      var rightPosition = clamp((upper - domainMinimum) / (domainMaximum - domainMinimum) * 100, 0, 100);
      var actionPosition = clamp((defaults.action - domainMinimum) / (domainMaximum - domainMinimum) * 100, 0, 100);
      var row = article.querySelector('[data-axis-bound="' + axis + '"]');

      states[axis] = {
        lower: lower,
        upper: upper,
        normalizedValue: normalizedValue,
        bin: bin,
        leftPosition: leftPosition,
        rightPosition: rightPosition,
        actionPosition: actionPosition
      };

      if (row) {
        row.style.setProperty("--axis-left", leftPosition.toFixed(2) + "%");
        row.style.setProperty("--axis-right", rightPosition.toFixed(2) + "%");
        row.style.setProperty("--axis-action", actionPosition.toFixed(2) + "%");
        row.dataset.normalizedValue = normalizedValue.toFixed(2);
        row.dataset.bin = String(bin);
      }

      setRoleText(article, ["normalization-" + axis + "-lower-value"], formatSigned(lower, 1) + " mm");
      setRoleText(article, ["normalization-" + axis + "-upper-value"], formatSigned(upper, 1) + " mm");
      setRoleText(article, ["normalization-" + axis + "-value"], normalizedValue.toFixed(2));
      setRoleText(article, ["normalization-" + axis + "-bin"], "#" + bin);
      setRoleText(article, ["normalization-dsd-direction-" + axis], defaults.direction.toFixed(2));
      setRoleText(article, ["normalization-dsd-token-" + axis], "token #" + defaults.token);
    });

    var selectedAxis = controller.normalizationAxis || "x";
    var selected = states[selectedAxis];
    article.style.setProperty("--motion-progress", mix.toFixed(4));
    article.style.setProperty("--stats-mix", mix.toFixed(4));
    article.style.setProperty("--stats-left", selected.leftPosition.toFixed(2) + "%");
    article.style.setProperty("--stats-right", selected.rightPosition.toFixed(2) + "%");
    article.style.setProperty("--stats-lower-position", selected.leftPosition.toFixed(2) + "%");
    article.style.setProperty("--stats-upper-position", selected.rightPosition.toFixed(2) + "%");
    article.style.setProperty("--stats-width", Math.max(0, selected.rightPosition - selected.leftPosition).toFixed(2) + "%");
    article.style.setProperty("--action-position", selected.actionPosition.toFixed(2) + "%");
    article.style.setProperty("--normalized-value", selected.normalizedValue.toFixed(4));
    article.style.setProperty("--normalization-position", (((selected.normalizedValue + 1) / 2) * 100).toFixed(2) + "%");
    article.style.setProperty("--norm-position", (((selected.normalizedValue + 1) / 2) * 100).toFixed(2) + "%");
    article.style.setProperty("--bin-index", String(selected.bin));
    article.dataset.normalizationAxis = selectedAxis;

    // Legacy single-axis roles follow the selected axis.
    setRoleText(article, ["normalization-value", "normalized-value", "norm-value", "stats-value"], selected.normalizedValue.toFixed(2));
    setRoleText(article, ["normalization-bin", "norm-bin", "stats-bin"], String(selected.bin));
    setRoleText(article, ["normalization-bin-label", "norm-bin-label"], "bin " + selected.bin);
    setRoleText(article, ["normalization-lower-value"], formatSigned(selected.lower, 1) + " mm");
    setRoleText(article, ["normalization-upper-value"], formatSigned(selected.upper, 1) + " mm");
    setRoleText(article, ["normalization-raw-token"], "bin " + selected.bin);
    setRoleText(article, ["normalization-dsd-direction"], "(0.62, 0.62, 0.47)");
    setRoleText(article, ["normalization-dsd-token"], "dir #207 \u00b7 #207 \u00b7 #187");
    // Demonstration-only magnitude bin: ||(4, 4, 3)|| = 6.40 mm is mapped
    // into a 256-bin vocabulary. Its illustrative upper bound moves from
    // 10.0 to 7.5 mm alongside the coordinate statistics, so this scale token
    // changes while the direction tokens remain fixed. The range is not a
    // learned statistic from the paper.
    var demonstrationMagnitude = vectorLength(NORMALIZATION_AXIS_ORDER.map(function (axis) {
      return NORMALIZATION_AXIS_DEFAULTS[axis].action;
    }));
    var demonstrationScaleUpper = lerp(10, 7.5, mix);
    var normalizedScale = clamp(2 * demonstrationMagnitude / demonstrationScaleUpper - 1, -1, 1);
    var demonstrationScaleToken = clamp(Math.floor(((normalizedScale + 1) / 2) * 256), 0, 255);
    setRoleText(article, ["normalization-dsd-scale-token"], "#" + demonstrationScaleToken);
    setRoleText(article, ["normalization-dsd-scale-token-value"], "#" + demonstrationScaleToken);
    setRoleText(article, ["normalization-dsd-scale-range"], "0–" + demonstrationScaleUpper.toFixed(1) + " mm");
    roleNodes(article, ["normalization-dsd-scale-token"]).forEach(function (node) {
      node.setAttribute("aria-label", "Illustrative scale token number " + demonstrationScaleToken);
    });
    article.dataset.dsdScaleUpper = demonstrationScaleUpper.toFixed(1);
    article.dataset.dsdScaleToken = String(demonstrationScaleToken);

    if (!controller.statsPointerActive) {
      setBoundInput(controller.statsLowerInput, selected.lower);
      setBoundInput(controller.statsUpperInput, selected.upper);
    }
    setRoleText(article, ["normalization-control-lower-value"], formatSigned(selected.lower, 1) + " mm");
    setRoleText(article, ["normalization-control-upper-value"], formatSigned(selected.upper, 1) + " mm");
    if (controller.statsLowerInput) {
      controller.statsLowerInput.setAttribute("aria-valuetext", selectedAxis.toUpperCase() + "-axis lower bound " + selected.lower.toFixed(1) + " millimeters");
    }
    if (controller.statsUpperInput) {
      controller.statsUpperInput.setAttribute("aria-valuetext", selectedAxis.toUpperCase() + "-axis upper bound " + selected.upper.toFixed(1) + " millimeters");
    }
    updateNormalizationAxisButtons(controller);
  }

  function renderTransfer(controller, progress) {
    var article = controller.article;
    var mismatch = clamp(progress, 0, 1);
    var source = TRANSFER_SOURCE_ACTION.slice();

    // The encoded Bridge action stays fixed. We interpolate the affine
    // decoder's per-axis statistics from Bridge (matched) to Berkeley-UR5
    // (mismatched). For a fixed normalized action, interpolating the decoder's
    // offsets and ranges is equivalent to interpolating these decoded outputs.
    var rawOutput = source.map(function (value, index) {
      return lerp(value, TRANSFER_BERKELEY_OUTPUT[index], mismatch);
    });

    // The paper establishes that DSD preserves direction but does not report
    // a target-domain scale output for this example. Animate an explicitly
    // illustrative magnitude ratio so the green vector shows that its length
    // may change even while it stays collinear with the source direction.
    var illustrativeDsdTargetRatio = vectorLength(TRANSFER_BERKELEY_OUTPUT) / vectorLength(source);
    var dsdMagnitudeRatio = lerp(1, illustrativeDsdTargetRatio, mismatch);
    var dsdOutput = scaleVector(source, dsdMagnitudeRatio);
    var rawAngle = vectorAngle(source, rawOutput);
    var endpointAngle = vectorAngle(source, TRANSFER_BERKELEY_OUTPUT);
    if (endpointAngle > 1e-8) {
      // The paper reports 69.84° using unrounded statistics; the displayed
      // endpoint vector is rounded to two decimals, so calibrate the readout
      // continuously to land on the reported value.
      rawAngle = rawAngle * TRANSFER_BERKELEY_ANGLE / endpointAngle;
    }
    var mismatchPercent = Math.round(mismatch * 100);
    var decodingStatsLabel = mismatch <= 0.0001
      ? "Bridge (matched)"
      : (mismatch >= 0.9999
        ? "Berkeley-UR5 (mismatched)"
        : "Bridge \u2192 Berkeley-UR5 (" + mismatchPercent + "% mismatch)");

    article.dataset.mode = "comparison";
    article.style.setProperty("--transfer-mix", mismatch.toFixed(4));
    article.style.setProperty("--motion-progress", progress.toFixed(4));
    article.style.setProperty("--transfer-angle", rawAngle.toFixed(2) + "deg");
    article.style.setProperty("--transfer-angle-value", rawAngle.toFixed(4));
    article.style.setProperty("--transfer-x", rawOutput[0].toFixed(4));
    article.style.setProperty("--transfer-y", rawOutput[1].toFixed(4));
    article.style.setProperty("--transfer-z", rawOutput[2].toFixed(4));
    article.style.setProperty("--target-opacity", "1");
    article.style.setProperty("--dsd-opacity", "1");

    setRoleText(article, ["transfer-angle", "transfer-raw-angle", "angle-readout"], rawAngle.toFixed(2) + "\u00b0");
    setRoleText(article, ["transfer-summary-label"], "Raw vs DSD");
    setRoleText(article, ["transfer-angle-suffix"], " raw direction change · DSD 0°");
    setRoleText(article, ["transfer-source", "source-vector"], formatVector(source));
    setRoleText(article, ["transfer-output", "transfer-raw-output", "target-vector"], formatVector(rawOutput));
    setRoleText(article, ["transfer-dsd-output"], "direction preserved \u00b7 magnitude may change");
    setRoleText(article, ["transfer-input-value", "transfer-normalized-action", "transfer-tokenized-action"], formatUnitlessVector(TRANSFER_ENCODED_ACTION));
    setRoleText(article, ["transfer-mismatch", "transfer-mismatch-value", "transfer-stats-mismatch"], mismatchPercent + "%");
    setRoleText(article, ["transfer-learned-stats", "transfer-encoding-stats"], "Bridge");
    setRoleText(article, ["transfer-decoded-stats", "transfer-decoding-stats", "transfer-decoder-stats"], decodingStatsLabel);
    setRoleText(
      article,
      ["transfer-raw-status"],
      mismatch <= 0.0001 ? "matched" : (mismatch >= 0.9999 ? "distorted" : "changing")
    );
    setRoleText(
      article,
      ["transfer-result", "transfer-summary"],
      rawAngle.toFixed(2) + "\u00b0 raw change; DSD preserves direction"
    );

    var sourceVector = article.querySelector('[data-role="transfer-source-vector"]');
    var outputVector = article.querySelector('[data-role="transfer-output-vector"]');
    var dsdVector = article.querySelector('[data-role="transfer-dsd-vector"]');
    var dsdSourceVector = article.querySelector('[data-role="transfer-dsd-source-vector"], .sourceVectorGhost');
    var angleArc = article.querySelector('[data-role="transfer-angle-arc"]');
    var referenceLength = vectorLength(TRANSFER_SOURCE_ACTION);
    var sourceLength = 88 * clamp(vectorLength(source) / referenceLength, 0, 1.20);
    var rawLength = 88 * clamp(vectorLength(rawOutput) / referenceLength, 0, 1.20);
    var dsdLength = 88 * clamp(vectorLength(dsdOutput) / referenceLength, 0, 1.20);
    setLineEndpoint(sourceVector, source, sourceLength);
    setLineEndpoint(outputVector, rawOutput, rawLength);
    setLineEndpoint(dsdSourceVector, source, sourceLength);
    setLineEndpoint(dsdVector, dsdOutput, dsdLength);
    setAngleArc(angleArc, source, rawOutput, 42);
    setRoleText(article, ["transfer-output-label"], "Raw: current decoding statistics");
    setRoleText(article, ["transfer-dsd-label"], "DSD: direction preserved");

    delete article.dataset.inputPercent;
    article.dataset.mismatchPercent = String(mismatchPercent);
    article.dataset.decodingStats = mismatch <= 0.0001 ? "bridge" : (mismatch >= 0.9999 ? "berkeley-ur5" : "interpolated");
    article.dataset.rawAngle = rawAngle.toFixed(2);
    article.dataset.dsdMagnitudeRatio = dsdMagnitudeRatio.toFixed(2);
  }

  function StoryController(article) {
    this.article = article;
    this.stage = article.querySelector(".problemStage");
    this.name = String(article.dataset.story || "speed").toLowerCase();
    this.duration = Number(article.dataset.duration) || STORY_DURATION_MS;
    this.playButton = article.querySelector('[data-action="play"]');
    this.resetButton = article.querySelector('[data-action="reset"]');
    this.timeline = article.querySelector('input[data-role="timeline"]');
    this.timelineTitle = article.querySelector(".timelineTitle");
    this.phaseOutput = article.querySelector('output[data-role="phase"], [data-role="phase"]');
    this.elapsedOutput = article.querySelector('[data-role="elapsed"]');
    this.durationOutput = article.querySelector('[data-role="duration"]');
    this.statsLowerInput = article.querySelector('input[data-role="normalization-lower"], input[data-role="stats-left"]');
    this.statsUpperInput = article.querySelector('input[data-role="normalization-upper"], input[data-role="stats-right"]');
    this.normalizationAxisButtons = Array.prototype.slice.call(article.querySelectorAll('button[data-normalization-axis="x"], button[data-normalization-axis="y"], button[data-normalization-axis="z"]'));
    this.speedInput = article.querySelector('input[data-role="speed-factor"]');
    this.transferInput = article.querySelector('input[data-role="transfer-input"]');
    this.modeButtons = Array.prototype.slice.call(article.querySelectorAll('button[data-mode="raw"], button[data-mode="dsd"]'));
    this.progress = this.timeline ? rangeFraction(this.timeline) : 0;
    this.playing = false;
    this.visible = true;
    this.frame = 0;
    this.lastFrameTime = 0;
    this.pointerActive = false;
    this.resumeAfterPointer = false;
    this.statsPointerActive = false;
    this.statsManual = false;
    this.mode = "raw";
    this.speedFactor = this.speedInput ? Number(this.speedInput.value || 160) / 100 : 1.6;
    var selectedAxisButton = this.normalizationAxisButtons.find(function (button) {
      return button.getAttribute("aria-pressed") === "true" || button.getAttribute("aria-selected") === "true" || button.dataset.active === "true";
    });
    this.normalizationAxis = selectedAxisButton ? selectedAxisButton.dataset.normalizationAxis : "x";
    this.normalizationBounds = {};
    NORMALIZATION_AXIS_ORDER.forEach(function (axis) {
      var defaults = NORMALIZATION_AXIS_DEFAULTS[axis];
      this.normalizationBounds[axis] = {
        lower: defaults.targetLower,
        upper: defaults.targetUpper
      };
    }, this);

    if (this.name === "transfer") {
      this.progress = 0;
      setRangeFraction(this.timeline, 0);
      if (this.timelineTitle) this.timelineTitle.textContent = "Decoding-statistics mismatch";
      if (this.timeline) this.timeline.setAttribute("aria-label", "Decoding-statistics mismatch from matched Bridge statistics to Berkeley-UR5 statistics");

      // The shared story scrubber now owns this parameter. Suppress the old
      // standalone slider in static exports that still contain it.
      if (this.transferInput) {
        var oldTransferControl = this.transferInput.closest(".transferInputControl, .parameterControl");
        this.transferInput.disabled = true;
        this.transferInput.hidden = true;
        this.transferInput.style.display = "none";
        this.transferInput.setAttribute("aria-hidden", "true");
        if (oldTransferControl) {
          oldTransferControl.hidden = true;
          oldTransferControl.style.display = "none";
        }
      }
    }

    // Old sample/playhead circles were read as unexplained red dots. New
    // markup uses compact token markers; suppress the legacy dots if a stale
    // static export still contains them.
    Array.prototype.slice.call(article.querySelectorAll('.sampleDot, [data-role="speed-slow-dot"], [data-role="speed-fast-dot"]')).forEach(function (node) {
      node.hidden = true;
      node.style.display = "none";
    });

    var selectedMode = this.modeButtons.find(function (button) {
      return button.getAttribute("aria-pressed") === "true" || button.dataset.active === "true";
    });
    if (selectedMode) this.mode = selectedMode.dataset.mode || "raw";

    this.bind();
    this.updateModeButtons();
    this.render(true);
    this.setPlayingState(false);
  }

  StoryController.prototype.bind = function () {
    var controller = this;

    if (this.phaseOutput) {
      this.phaseOutput.setAttribute("aria-live", "polite");
      this.phaseOutput.setAttribute("aria-atomic", "true");
    }

    if (this.playButton) {
      this.playButton.addEventListener("click", function () {
        if (controller.playing) controller.pause("user");
        else controller.play();
      });
    }

    if (this.resetButton) {
      this.resetButton.addEventListener("click", function () {
        controller.reset();
      });
    }

    if (this.timeline) {
      this.timeline.addEventListener("pointerdown", function () {
        controller.pointerActive = true;
        controller.resumeAfterPointer = controller.playing;
        if (controller.name === "normalization") controller.statsManual = false;
        controller.pause("scrub");
      });
      this.timeline.addEventListener("input", function () {
        if (!controller.pointerActive) controller.pause("scrub");
        if (controller.name === "normalization") controller.statsManual = false;
        controller.setProgress(rangeFraction(controller.timeline), true);
      });
      ["pointerup", "pointercancel"].forEach(function (eventName) {
        controller.timeline.addEventListener(eventName, function () {
          var shouldResume = controller.resumeAfterPointer;
          controller.pointerActive = false;
          controller.resumeAfterPointer = false;
          if (shouldResume && controller.visible) controller.play();
        });
      });
      this.timeline.addEventListener("change", function () {
        controller.render(true);
      });
    }

    if (this.name === "normalization") {
      this.normalizationAxisButtons.forEach(function (button, index) {
        button.addEventListener("click", function () {
          var axis = button.dataset.normalizationAxis;
          if (!NORMALIZATION_AXIS_DEFAULTS[axis]) return;
          controller.pause("axis-selection");
          controller.normalizationAxis = axis;
          updateNormalizationAxisButtons(controller);
          controller.render(true);
        });
        button.addEventListener("keydown", function (event) {
          var nextIndex = null;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % controller.normalizationAxisButtons.length;
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + controller.normalizationAxisButtons.length) % controller.normalizationAxisButtons.length;
          if (event.key === "Home") nextIndex = 0;
          if (event.key === "End") nextIndex = controller.normalizationAxisButtons.length - 1;
          if (nextIndex !== null && controller.normalizationAxisButtons[nextIndex]) {
            event.preventDefault();
            controller.normalizationAxisButtons[nextIndex].focus();
            controller.normalizationAxisButtons[nextIndex].click();
          }
        });
      });

      [this.statsLowerInput, this.statsUpperInput].filter(Boolean).forEach(function (input) {
        input.addEventListener("pointerdown", function () {
          controller.statsPointerActive = true;
          controller.pause("bound-adjustment");
        });
        input.addEventListener("input", function () {
          controller.pause("bound-adjustment");
          controller.statsPointerActive = true;
          var axis = controller.normalizationAxis || "x";
          var bounds = controller.normalizationBounds[axis];
          var lower = readBound(controller.statsLowerInput, bounds.lower);
          var upper = readBound(controller.statsUpperInput, bounds.upper);
          if (upper <= lower + 0.10) {
            if (input === controller.statsLowerInput) lower = upper - 0.10;
            else upper = lower + 0.10;
          }
          bounds.lower = lower;
          bounds.upper = upper;
          controller.setProgress(1, true);
        });
        ["pointerup", "pointercancel", "change", "blur"].forEach(function (eventName) {
          input.addEventListener(eventName, function () {
            controller.statsPointerActive = false;
            controller.render(true);
          });
        });
      });
    }

    if (this.speedInput && this.name === "speed") {
      this.speedInput.addEventListener("input", function () {
        controller.speedFactor = clamp(Number(controller.speedInput.value || 160) / 100, 0.1, 4);
        controller.speedInput.setAttribute("aria-valuetext", controller.speedFactor.toFixed(1) + " times speed");
        controller.render(true);
      });
      this.speedInput.setAttribute("aria-valuetext", this.speedFactor.toFixed(1) + " times speed");
    }

    this.modeButtons.forEach(function (button, index) {
      button.addEventListener("click", function () {
        controller.mode = button.dataset.mode === "dsd" ? "dsd" : "raw";
        controller.updateModeButtons();
        controller.render(true);
      });
      button.addEventListener("keydown", function (event) {
        var nextIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % controller.modeButtons.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + controller.modeButtons.length) % controller.modeButtons.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = controller.modeButtons.length - 1;
        if (nextIndex !== null) {
          event.preventDefault();
          controller.modeButtons[nextIndex].focus();
          controller.modeButtons[nextIndex].click();
        }
      });
    });
  };

  StoryController.prototype.updateModeButtons = function () {
    var controller = this;
    this.modeButtons.forEach(function (button) {
      var selected = button.dataset.mode === controller.mode;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
      button.dataset.active = selected ? "true" : "false";
    });
  };

  StoryController.prototype.setPlayingState = function (playing) {
    this.playing = playing;
    this.article.dataset.state = playing ? "playing" : (this.progress >= 1 ? "ended" : (this.progress > 0 ? "paused" : "idle"));
    if (this.playButton) {
      setButtonLabel(this.playButton, playing ? "Pause" : "Play");
      this.playButton.setAttribute("aria-pressed", playing ? "true" : "false");
    }
  };

  StoryController.prototype.play = function () {
    if (!this.visible || document.hidden) return;
    if (this.progress >= 1) {
      if (this.name === "normalization") this.statsManual = false;
      this.setProgress(0, true);
    }
    if (activeStory && activeStory !== this) activeStory.pause("another-story");
    activeStory = this;
    this.lastFrameTime = 0;
    this.setPlayingState(true);
    this.frame = window.requestAnimationFrame(this.tick.bind(this));
  };

  StoryController.prototype.pause = function () {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastFrameTime = 0;
    this.setPlayingState(false);
    if (activeStory === this) activeStory = null;
  };

  StoryController.prototype.reset = function () {
    this.pause("reset");
    if (this.name === "normalization") {
      this.statsManual = false;
      NORMALIZATION_AXIS_ORDER.forEach(function (axis) {
        var defaults = NORMALIZATION_AXIS_DEFAULTS[axis];
        this.normalizationBounds[axis].lower = defaults.targetLower;
        this.normalizationBounds[axis].upper = defaults.targetUpper;
      }, this);
    }
    // Every story resets to the beginning. For transfer, zero means matched
    // Bridge decoding statistics; Play then sweeps to Berkeley-UR5 statistics.
    this.setProgress(0, true);
  };

  StoryController.prototype.tick = function (timestamp) {
    if (!this.playing) return;
    if (!this.lastFrameTime) this.lastFrameTime = timestamp;
    var elapsed = Math.min(80, timestamp - this.lastFrameTime);
    this.lastFrameTime = timestamp;
    this.setProgress(this.progress + elapsed / this.duration, false);
    if (this.progress >= 1) {
      this.setPlayingState(false);
      if (activeStory === this) activeStory = null;
      return;
    }
    this.frame = window.requestAnimationFrame(this.tick.bind(this));
  };

  StoryController.prototype.setProgress = function (progress, announce) {
    this.progress = clamp(progress, 0, 1);
    if (this.timeline && !this.pointerActive) setRangeFraction(this.timeline, this.progress);
    this.render(Boolean(announce));
  };

  StoryController.prototype.render = function () {
    var progress = clamp(this.progress, 0, 1);
    var elapsedSeconds = progress * this.duration / 1000;
    var durationSeconds = this.duration / 1000;
    var elapsedText = elapsedSeconds.toFixed(1) + " s";
    var durationText = durationSeconds.toFixed(1) + " s";
    var transferPercent = Math.round(progress * 100);
    this.article.style.setProperty("--progress", progress.toFixed(4));
    this.article.style.setProperty("--progress-percent", (progress * 100).toFixed(2) + "%");
    if (this.stage) {
      // `.problemStage` supplies a static fallback, so set the live value there
      // as well as on the article to avoid the local custom-property shadow.
      this.stage.style.setProperty("--progress", progress.toFixed(4));
      this.stage.style.setProperty("--progress-percent", (progress * 100).toFixed(2) + "%");
    }
    this.article.dataset.progress = String(Math.round(progress * 100));
    this.article.dataset.reducedMotion = reducedMotion.matches ? "true" : "false";

    if (this.name === "transfer") {
      var mismatchText = transferPercent + "%";
      delete this.article.dataset.motionTime;
      delete this.article.dataset.inputPercent;
      this.article.dataset.mismatchPercent = String(transferPercent);
      if (this.timelineTitle) this.timelineTitle.textContent = "Decoding-statistics mismatch";
      if (this.timeline) {
        this.timeline.setAttribute("aria-label", "Decoding-statistics mismatch from matched Bridge statistics to Berkeley-UR5 statistics");
        this.timeline.setAttribute("aria-valuetext", "Decoding-statistics mismatch " + mismatchText);
      }
      if (this.elapsedOutput) this.elapsedOutput.textContent = mismatchText;
      if (this.durationOutput) this.durationOutput.textContent = "100%";
      if (this.phaseOutput) this.phaseOutput.textContent = mismatchText + " / 100%";
    } else {
      this.article.dataset.motionTime = elapsedSeconds.toFixed(1);
      if (this.timeline) {
        this.timeline.setAttribute("aria-valuetext", "Motion time " + elapsedText + " of " + durationText);
      }
      if (this.elapsedOutput) this.elapsedOutput.textContent = elapsedText;
      if (this.durationOutput) this.durationOutput.textContent = durationText;
      // Legacy exports used data-role="phase". Keep it useful, but never
      // return to a step counter: this scrubber denotes the complete motion.
      if (this.phaseOutput) this.phaseOutput.textContent = elapsedText + " / " + durationText;
    }

    if (this.name === "normalization") renderNormalization(this, progress);
    else if (this.name === "transfer") renderTransfer(this, progress);
    else renderSpeed(this, progress);
  };

  function initStories() {
    var articles = Array.prototype.slice.call(document.querySelectorAll("article.problemStory[data-story]"));
    var controllers = articles.map(function (article) {
      return new StoryController(article);
    });

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var controller = controllers.find(function (candidate) {
            return candidate.article === entry.target;
          });
          if (!controller) return;
          controller.visible = entry.isIntersecting && entry.intersectionRatio >= 0.10;
          if (!controller.visible && controller.playing) controller.pause("offscreen");
        });
      }, { threshold: [0, 0.10, 0.5] });
      articles.forEach(function (article) { observer.observe(article); });
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        controllers.forEach(function (controller) { controller.pause("hidden"); });
      }
    });

    var updateMotionPreference = function () {
      controllers.forEach(function (controller) {
        if (reducedMotion.matches) controller.pause("reduced-motion");
        controller.render(true);
      });
    };
    if (typeof reducedMotion.addEventListener === "function") reducedMotion.addEventListener("change", updateMotionPreference);
    else if (typeof reducedMotion.addListener === "function") reducedMotion.addListener(updateMotionPreference);

    return controllers;
  }

  function valueFrom(button, primary, fallback) {
    var value = button.dataset[primary];
    if (value !== undefined && value !== "") return value;
    var attribute = button.getAttribute("data-robot-" + primary.replace(/[A-Z]/g, function (letter) {
      return "-" + letter.toLowerCase();
    }));
    return attribute || fallback || "";
  }

  function taskKey(button) {
    return valueFrom(button, "task", button.getAttribute("data-robot-task") || "").trim();
  }

  function methodKey(button) {
    return valueFrom(button, "method", button.getAttribute("data-robot-method") || "").trim();
  }

  function buttonLabel(button, kind) {
    return valueFrom(button, kind + "Label", button.textContent.trim());
  }

  function setToggleState(buttons, activeButton) {
    buttons.forEach(function (button) {
      var selected = button === activeButton;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
      button.dataset.active = selected ? "true" : "false";
      button.classList.toggle("active", selected);
    });
  }

  function bindRovingTablist(getButtons, activate) {
    getButtons().forEach(function (button) {
      button.addEventListener("keydown", function (event) {
        var buttons = getButtons().filter(function (candidate) { return !candidate.disabled && !candidate.hidden; });
        var index = buttons.indexOf(button);
        var nextIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % buttons.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + buttons.length) % buttons.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = buttons.length - 1;
        if (nextIndex !== null && buttons[nextIndex]) {
          event.preventDefault();
          buttons[nextIndex].focus();
          activate(buttons[nextIndex], true);
        }
      });
    });
  }

  function initRobotViewer() {
    var video = document.querySelector('video[data-role="robot-player"]');
    if (!video) return null;

    var scope = video.closest("[data-robot-browser], [data-robot-viewer], .robotViewer, .robotSection") || document;
    var taskButtons = Array.prototype.slice.call(scope.querySelectorAll("button[data-robot-task]"));
    var methodButtons = Array.prototype.slice.call(scope.querySelectorAll("button[data-robot-method]"));
    var methodPanels = Array.prototype.slice.call(scope.querySelectorAll("[data-task-panel]"));
    var source = video.querySelector("source");
    var taskCaption = roleNodes(scope, ["robot-task"]);
    var methodCaption = roleNodes(scope, ["robot-method"]);
    var scoreCaption = roleNodes(scope, ["robot-score"]);
    var status = scope.querySelector('[data-role="robot-status"]');
    var previousButtons = Array.prototype.slice.call(scope.querySelectorAll('[data-action="robot-prev"], [data-action="prev"], [data-robot-prev]'));
    var nextButtons = Array.prototype.slice.call(scope.querySelectorAll('[data-action="robot-next"], [data-action="next"], [data-robot-next]'));
    var activeTask = taskButtons.find(function (button) {
      return button.getAttribute("aria-pressed") === "true" || button.dataset.active === "true";
    }) || taskButtons[0] || null;
    var activeMethod = null;
    var rememberedMethod = {};

    video.autoplay = false;
    video.removeAttribute("autoplay");
    video.pause();
    video.playsInline = true;

    if (status) {
      status.setAttribute("aria-live", "polite");
      status.setAttribute("aria-atomic", "true");
    }

    function currentTaskKey() {
      return activeTask ? taskKey(activeTask) : (activeMethod ? taskKey(activeMethod) : "");
    }

    function availableMethods() {
      var selectedTask = currentTaskKey();
      return methodButtons.filter(function (button) {
        var belongsTo = taskKey(button);
        return !selectedTask || !belongsTo || belongsTo === selectedTask;
      });
    }

    function writeCaption(nodes, text) {
      nodes.forEach(function (node) { node.textContent = text; });
    }

    function updateCaptions(button) {
      if (!button) return;
      var task = taskKey(button);
      var taskButton = taskButtons.find(function (candidate) { return taskKey(candidate) === task; });
      var taskText = valueFrom(button, "taskLabel", taskButton ? buttonLabel(taskButton, "task") : task);
      var methodText = buttonLabel(button, "method") || methodKey(button);
      var scoreText = valueFrom(button, "score", "");
      if (/^-?\d+(?:\.\d+)?$/.test(scoreText)) scoreText += "%";
      writeCaption(taskCaption, taskText);
      writeCaption(methodCaption, methodText);
      writeCaption(scoreCaption, scoreText);
      video.setAttribute("aria-label", [taskText, methodText, scoreText].filter(Boolean).join(", "));
    }

    function activateMethod(button, play) {
      if (!button) return;
      var src = valueFrom(button, "src", "");
      var poster = valueFrom(button, "poster", "");
      var buttonTask = taskKey(button);
      var matchingTask = taskButtons.find(function (candidate) { return taskKey(candidate) === buttonTask; });
      if (matchingTask && matchingTask !== activeTask) {
        activeTask = matchingTask;
        setToggleState(taskButtons, activeTask);
      }

      activeMethod = button;
      if (buttonTask) rememberedMethod[buttonTask] = methodKey(button);
      setToggleState(methodButtons, button);
      updateCaptions(button);

      if (poster) video.poster = poster;
      if (!src) return;

      video.pause();
      if (source) source.src = src;
      else video.src = src;
      video.load();

      if (status) status.textContent = "Loaded " + buttonLabel(button, "method") + " rollout.";
      if (play) safePlay(video);
    }

    function updateMethodsForTask(play) {
      var selectedTask = currentTaskKey();
      methodPanels.forEach(function (panel) {
        var visible = !selectedTask || panel.dataset.taskPanel === selectedTask;
        panel.hidden = !visible;
        panel.setAttribute("aria-hidden", visible ? "false" : "true");
      });
      methodButtons.forEach(function (button) {
        var belongsTo = taskKey(button);
        var visible = !selectedTask || !belongsTo || belongsTo === selectedTask;
        button.hidden = !visible;
        button.setAttribute("aria-hidden", visible ? "false" : "true");
      });

      var methods = availableMethods();
      var remembered = rememberedMethod[selectedTask];
      var preferred = methods.find(function (button) { return methodKey(button) === remembered; }) ||
        methods.find(function (button) { return button.getAttribute("aria-pressed") === "true"; }) || methods[0];
      if (preferred) activateMethod(preferred, play);
    }

    function activateTask(button, play) {
      if (!button) return;
      activeTask = button;
      setToggleState(taskButtons, button);
      updateMethodsForTask(play);
    }

    taskButtons.forEach(function (button) {
      button.addEventListener("click", function () { activateTask(button, true); });
    });
    methodButtons.forEach(function (button) {
      button.addEventListener("click", function () { activateMethod(button, true); });
    });

    function stepMethod(direction) {
      var methods = availableMethods();
      if (!methods.length) return;
      var index = methods.indexOf(activeMethod);
      var nextIndex = (index + direction + methods.length) % methods.length;
      activateMethod(methods[nextIndex], true);
      methods[nextIndex].focus({ preventScroll: true });
    }

    previousButtons.forEach(function (button) {
      button.addEventListener("click", function () { stepMethod(-1); });
    });
    nextButtons.forEach(function (button) {
      button.addEventListener("click", function () { stepMethod(1); });
    });

    bindRovingTablist(function () { return taskButtons; }, activateTask);
    bindRovingTablist(function () { return methodButtons; }, activateMethod);

    // Select the initial labels and tabs without loading or autoplaying media.
    if (activeTask) {
      setToggleState(taskButtons, activeTask);
      var selectedTask = currentTaskKey();
      methodPanels.forEach(function (panel) {
        var visible = !selectedTask || panel.dataset.taskPanel === selectedTask;
        panel.hidden = !visible;
        panel.setAttribute("aria-hidden", visible ? "false" : "true");
      });
      methodButtons.forEach(function (button) {
        var belongsTo = taskKey(button);
        var visible = !selectedTask || !belongsTo || belongsTo === selectedTask;
        button.hidden = !visible;
        button.setAttribute("aria-hidden", visible ? "false" : "true");
      });
      var initialMethods = availableMethods();
      activeMethod = initialMethods.find(function (button) {
        return button.getAttribute("aria-pressed") === "true" || button.dataset.active === "true";
      }) || initialMethods[0] || null;
    } else {
      activeMethod = methodButtons[0] || null;
    }
    if (activeMethod) {
      setToggleState(methodButtons, activeMethod);
      updateCaptions(activeMethod);
    }

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.08) video.pause();
        });
      }, { threshold: [0, 0.08, 0.5] });
      observer.observe(video);
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) video.pause();
    });

    return { video: video, activateTask: activateTask, activateMethod: activateMethod };
  }

  function initLightVideos() {
    var selector = [
      "video[data-light-video]",
      'video[data-role="light-video"]',
      ".lightRollout video",
      ".lightCard video",
      ".rolloutGrid video"
    ].join(",");
    var videos = Array.prototype.slice.call(new Set(Array.prototype.slice.call(document.querySelectorAll(selector))));
    var visibility = new Map();

    function mayAutoplay(video) {
      return !document.hidden && !reducedMotion.matches && visibility.get(video) === true;
    }

    function updateVideo(video) {
      if (mayAutoplay(video)) {
        if (video.readyState === 0) video.load();
        safePlay(video);
      } else if (!video.paused) {
        video.pause();
      }
    }

    videos.forEach(function (video) {
      video.muted = true;
      video.playsInline = true;
      video.controls = true;
      if (!video.getAttribute("preload") || video.getAttribute("preload") === "none") {
        video.preload = "metadata";
      }
      visibility.set(video, false);
      video.addEventListener("loadeddata", function () { updateVideo(video); });
      video.addEventListener("canplay", function () { updateVideo(video); });
    });

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          visibility.set(entry.target, entry.isIntersecting && entry.intersectionRatio >= 0.15);
          updateVideo(entry.target);
        });
      }, { threshold: [0, 0.15, 0.50] });
      videos.forEach(function (video) { observer.observe(video); });
    } else {
      var scheduled = false;
      var checkVisibility = function () {
        scheduled = false;
        videos.forEach(function (video) {
          var rectangle = video.getBoundingClientRect();
          var visibleHeight = Math.min(rectangle.bottom, window.innerHeight) - Math.max(rectangle.top, 0);
          var ratio = rectangle.height > 0 ? clamp(visibleHeight / rectangle.height, 0, 1) : 0;
          visibility.set(video, ratio >= 0.15);
          updateVideo(video);
        });
      };
      var scheduleCheck = function () {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(checkVisibility);
      };
      window.addEventListener("scroll", scheduleCheck, { passive: true });
      window.addEventListener("resize", scheduleCheck, { passive: true });
      scheduleCheck();
    }

    function updateAll() {
      videos.forEach(updateVideo);
    }

    document.addEventListener("visibilitychange", updateAll);
    if (typeof reducedMotion.addEventListener === "function") reducedMotion.addEventListener("change", updateAll);
    else if (typeof reducedMotion.addListener === "function") reducedMotion.addListener(updateAll);

    return videos;
  }

  ready(function () {
    initStories();
    initRobotViewer();
    initLightVideos();
  });
})();
