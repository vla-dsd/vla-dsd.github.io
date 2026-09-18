(function () {
  "use strict";

  var STORY_DURATION_MS = 7000;
  var activeStory = null;

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

  function readTransferScale(input) {
    var value = readNumeric(input, 100);
    var maximum = input ? Number(input.max || 100) : 100;
    return clamp(maximum > 4 ? value / 100 : value, 0.20, 2.50);
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

  function mixVector(start, end, amount) {
    return start.map(function (value, index) {
      return lerp(value, end[index], amount);
    });
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
    var fastProgress = clamp(motionProgress * speedFactor, 0, 1);
    var directionSequence = [
      [222, 151, 132], [219, 157, 132], [216, 163, 131],
      [211, 170, 131], [205, 177, 130], [198, 184, 129],
      [191, 190, 128], [184, 197, 127], [176, 204, 126],
      [168, 211, 125], [160, 217, 124], [153, 222, 123]
    ];
    var slowTokenIndex = Math.min(directionSequence.length - 1, Math.floor(motionProgress * directionSequence.length));
    var fastTokenIndex = Math.min(directionSequence.length - 1, Math.floor(fastProgress * directionSequence.length));
    var slowDirectionTokens = directionSequence[slowTokenIndex];
    var fastDirectionTokens = directionSequence[fastTokenIndex];
    var slowMagnitude = 0.42;
    var fastMagnitude = slowMagnitude * speedFactor;
    var slowRawTokens = slowDirectionTokens.map(function (value) {
      return 128 + (value - 128) * slowMagnitude;
    });
    var fastRawTokens = fastDirectionTokens.map(function (value) {
      return 128 + (value - 128) * fastMagnitude;
    });
    var slowScaleToken = Math.round(128 + 46 * slowMagnitude);
    var fastScaleToken = Math.round(128 + 46 * fastMagnitude);

    article.style.setProperty("--motion-progress", motionProgress.toFixed(4));
    article.style.setProperty("--slow-progress", motionProgress.toFixed(4));
    article.style.setProperty("--fast-progress", fastProgress.toFixed(4));
    article.style.setProperty("--speed-factor", speedFactor.toFixed(2));
    article.style.setProperty("--slow-step-scale", slowMagnitude.toFixed(3));
    article.style.setProperty("--fast-step-scale", fastMagnitude.toFixed(3));

    var slowMarker = article.querySelector('[data-role="speed-slow-marker"]');
    var fastMarker = article.querySelector('[data-role="speed-fast-marker"]');
    var slowPath = article.querySelector('[data-role="slow-path"]');
    var fastPath = article.querySelector('[data-role="fast-path"]') || slowPath;
    positionOnPath(slowMarker, slowPath, motionProgress);
    positionOnPath(fastMarker, fastPath, fastProgress);

    // These values never disappear: the current action token is visible for
    // every sample of the motion, including the initial frame.
    setRoleText(article, ["speed-raw-slow-token", "speed-slow-token", "slow-token"], formatTokens(slowRawTokens));
    setRoleText(article, ["speed-raw-fast-token", "speed-fast-token", "fast-token"], formatTokens(fastRawTokens));
    setRoleText(article, ["speed-dsd-direction-slow"], formatTokens(slowDirectionTokens));
    setRoleText(article, ["speed-dsd-direction-fast"], formatTokens(fastDirectionTokens));
    setRoleText(article, ["speed-dsd-scale-slow"], "scale #" + slowScaleToken);
    setRoleText(article, ["speed-dsd-scale-fast"], "scale #" + fastScaleToken);
    setRoleText(article, ["speed-slow-progress"], Math.round(motionProgress * 100) + "%");
    setRoleText(article, ["speed-fast-progress"], Math.round(fastProgress * 100) + "%");
    setRoleText(article, ["speed-fast-value", "speed-factor-value"], speedFactor.toFixed(1) + "\u00d7");
    article.dataset.slowTokenIndex = String(slowTokenIndex + 1);
    article.dataset.fastTokenIndex = String(fastTokenIndex + 1);
  }

  function renderNormalization(controller, progress) {
    var article = controller.article;
    var mix = smoothstep(progress);
    var actionValue = 4;
    var lowerTarget = controller.statsLowerTarget;
    var upperTarget = controller.statsUpperTarget;

    // Animate the two endpoints independently. The physical action stays at
    // 4 mm; only the statistics interval changes around it.
    var lower = controller.statsManual ? lowerTarget : lerp(controller.statsLowerStart, lowerTarget, mix);
    var upper = controller.statsManual ? upperTarget : lerp(controller.statsUpperStart, upperTarget, mix);
    if (upper <= lower + 0.10) upper = lower + 0.10;
    var normalizedValue = clamp(2 * (actionValue - lower) / (upper - lower) - 1, -1, 1);
    var bin = clamp(Math.floor(((normalizedValue + 1) / 2) * 256), 0, 255);
    var position = ((normalizedValue + 1) / 2) * 100;
    var domainMinimum = -8;
    var domainMaximum = 14;
    var leftPosition = clamp((lower - domainMinimum) / (domainMaximum - domainMinimum) * 100, 0, 100);
    var rightPosition = clamp((upper - domainMinimum) / (domainMaximum - domainMinimum) * 100, 0, 100);
    var actionPosition = clamp((actionValue - domainMinimum) / (domainMaximum - domainMinimum) * 100, 0, 100);

    article.style.setProperty("--motion-progress", mix.toFixed(4));
    article.style.setProperty("--stats-mix", mix.toFixed(4));
    article.style.setProperty("--stats-left", leftPosition.toFixed(2) + "%");
    article.style.setProperty("--stats-right", rightPosition.toFixed(2) + "%");
    article.style.setProperty("--stats-lower-position", leftPosition.toFixed(2) + "%");
    article.style.setProperty("--stats-upper-position", rightPosition.toFixed(2) + "%");
    article.style.setProperty("--stats-width", Math.max(0, rightPosition - leftPosition).toFixed(2) + "%");
    article.style.setProperty("--action-position", actionPosition.toFixed(2) + "%");
    article.style.setProperty("--normalized-value", normalizedValue.toFixed(4));
    article.style.setProperty("--normalization-position", position.toFixed(2) + "%");
    article.style.setProperty("--norm-position", position.toFixed(2) + "%");
    article.style.setProperty("--bin-index", String(bin));

    setRoleText(article, ["normalization-value", "normalized-value", "norm-value", "stats-value"], normalizedValue.toFixed(2));
    setRoleText(article, ["normalization-bin", "norm-bin", "stats-bin"], String(bin));
    setRoleText(article, ["normalization-bin-label", "norm-bin-label"], "bin " + bin);
    setRoleText(article, ["normalization-lower-value"], formatSigned(lower, 1) + " mm");
    setRoleText(article, ["normalization-upper-value"], formatSigned(upper, 1) + " mm");
    setRoleText(article, ["normalization-raw-token"], "bin " + bin);
    setRoleText(article, ["normalization-dsd-direction"], "(0.62, 0.62, 0.47)");
    setRoleText(article, ["normalization-dsd-token"], "dir #207 \u00b7 #207 \u00b7 #187");

    if (!controller.statsPointerActive && !controller.statsManual) {
      setBoundInput(controller.statsLowerInput, lower);
      setBoundInput(controller.statsUpperInput, upper);
    }
    if (controller.statsLowerInput) {
      controller.statsLowerInput.setAttribute("aria-valuetext", "Lower statistics bound " + lower.toFixed(1) + " millimeters");
    }
    if (controller.statsUpperInput) {
      controller.statsUpperInput.setAttribute("aria-valuetext", "Upper statistics bound " + upper.toFixed(1) + " millimeters");
    }
  }

  function renderTransfer(controller, progress) {
    var article = controller.article;
    var change = smoothstep(progress);
    var inputScale = controller.transferInputScale;
    var baseSource = [2.90, -4.60, 3.40];
    var source = scaleVector(baseSource, inputScale);
    var rawTarget = [
      0.65 * source[0] + 0.295,
      0.55 * source[1] + 0.510,
      -0.45 * source[2] - 0.660
    ];
    var dsdTarget = scaleVector(source, 0.82 + 0.10 * inputScale);
    var rawOutput = mixVector(source, rawTarget, change);
    var dsdOutput = mixVector(source, dsdTarget, change);
    var rawAngle = vectorAngle(source, rawOutput);
    var fullRawAngle = vectorAngle(source, rawTarget);
    if (Math.abs(inputScale - 1) < 0.0001 && fullRawAngle > 1e-8) {
      rawAngle = rawAngle * 69.84 / fullRawAngle;
      fullRawAngle = 69.84;
    }

    article.dataset.mode = "comparison";
    article.style.setProperty("--transfer-mix", change.toFixed(4));
    article.style.setProperty("--motion-progress", change.toFixed(4));
    article.style.setProperty("--transfer-angle", rawAngle.toFixed(2) + "deg");
    article.style.setProperty("--transfer-angle-value", rawAngle.toFixed(4));
    article.style.setProperty("--transfer-x", rawOutput[0].toFixed(4));
    article.style.setProperty("--transfer-y", rawOutput[1].toFixed(4));
    article.style.setProperty("--transfer-z", rawOutput[2].toFixed(4));
    article.style.setProperty("--target-opacity", (0.20 + 0.80 * change).toFixed(4));
    article.style.setProperty("--dsd-opacity", (0.20 + 0.80 * change).toFixed(4));

    setRoleText(article, ["transfer-angle", "transfer-raw-angle", "angle-readout"], rawAngle.toFixed(2) + "\u00b0");
    setRoleText(article, ["transfer-summary-label"], "Raw vs DSD");
    setRoleText(article, ["transfer-angle-suffix"], " raw direction change · DSD 0°");
    setRoleText(article, ["transfer-source", "source-vector"], formatVector(source));
    setRoleText(article, ["transfer-output", "transfer-raw-output", "target-vector"], formatVector(rawOutput));
    setRoleText(article, ["transfer-dsd-output"], formatVector(dsdOutput));
    setRoleText(article, ["transfer-input-value"], formatUnitlessVector(scaleVector([0.109, -0.101, -0.110], inputScale)));
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
    var referenceLength = vectorLength(baseSource);
    var sourceLength = 88 * clamp(vectorLength(source) / referenceLength, 0, 1.20);
    var rawLength = 88 * clamp(vectorLength(rawOutput) / referenceLength, 0, 1.20);
    var dsdLength = 88 * clamp(vectorLength(dsdOutput) / referenceLength, 0, 1.20);
    setLineEndpoint(sourceVector, source, sourceLength);
    setLineEndpoint(outputVector, rawOutput, rawLength);
    setLineEndpoint(dsdSourceVector, source, sourceLength);
    setLineEndpoint(dsdVector, dsdOutput, dsdLength);
    setAngleArc(angleArc, source, rawOutput, 42);
    setRoleText(article, ["transfer-output-label"], "Raw: target-stat denormalization");
    setRoleText(article, ["transfer-dsd-label"], "DSD: direction preserved");

    if (controller.transferInput) {
      controller.transferInput.setAttribute("aria-valuetext", Math.round(inputScale * 100) + "% of the example input action");
    }
    article.dataset.rawAngle = fullRawAngle.toFixed(2);
  }

  function StoryController(article) {
    this.article = article;
    this.stage = article.querySelector(".problemStage");
    this.name = String(article.dataset.story || "speed").toLowerCase();
    this.duration = Number(article.dataset.duration) || STORY_DURATION_MS;
    this.playButton = article.querySelector('[data-action="play"]');
    this.resetButton = article.querySelector('[data-action="reset"]');
    this.timeline = article.querySelector('input[data-role="timeline"]');
    this.phaseOutput = article.querySelector('output[data-role="phase"], [data-role="phase"]');
    this.elapsedOutput = article.querySelector('[data-role="elapsed"]');
    this.durationOutput = article.querySelector('[data-role="duration"]');
    this.statsLowerInput = article.querySelector('input[data-role="normalization-lower"], input[data-role="stats-left"]');
    this.statsUpperInput = article.querySelector('input[data-role="normalization-upper"], input[data-role="stats-right"]');
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
    this.statsLowerStart = readBound(this.statsLowerInput, -4.00);
    this.statsUpperStart = readBound(this.statsUpperInput, 9.90);
    this.statsLowerTarget = -0.50;
    this.statsUpperTarget = 4.29;
    this.transferInputScale = readTransferScale(this.transferInput);

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
      [this.statsLowerInput, this.statsUpperInput].filter(Boolean).forEach(function (input) {
        input.addEventListener("pointerdown", function () {
          controller.statsPointerActive = true;
          controller.statsManual = true;
          controller.pause("bound-adjustment");
        });
        input.addEventListener("input", function () {
          controller.pause("bound-adjustment");
          controller.statsPointerActive = true;
          controller.statsManual = true;
          var lower = readBound(controller.statsLowerInput, controller.statsLowerTarget);
          var upper = readBound(controller.statsUpperInput, controller.statsUpperTarget);
          if (upper <= lower + 0.10) {
            if (input === controller.statsLowerInput) lower = upper - 0.10;
            else upper = lower + 0.10;
          }
          controller.statsLowerTarget = lower;
          controller.statsUpperTarget = upper;
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

    if (this.transferInput && this.name === "transfer") {
      this.transferInput.addEventListener("input", function () {
        controller.pause("input-adjustment");
        controller.transferInputScale = readTransferScale(controller.transferInput);
        controller.setProgress(1, true);
      });
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
      this.statsLowerTarget = -0.50;
      this.statsUpperTarget = 4.29;
    }
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
    this.article.style.setProperty("--progress", progress.toFixed(4));
    this.article.style.setProperty("--progress-percent", (progress * 100).toFixed(2) + "%");
    if (this.stage) {
      // `.problemStage` supplies a static fallback, so set the live value there
      // as well as on the article to avoid the local custom-property shadow.
      this.stage.style.setProperty("--progress", progress.toFixed(4));
      this.stage.style.setProperty("--progress-percent", (progress * 100).toFixed(2) + "%");
    }
    this.article.dataset.progress = String(Math.round(progress * 100));
    this.article.dataset.motionTime = elapsedSeconds.toFixed(1);
    this.article.dataset.reducedMotion = reducedMotion.matches ? "true" : "false";

    if (this.timeline) {
      this.timeline.setAttribute("aria-valuetext", "Motion time " + elapsedText + " of " + durationText);
    }
    if (this.elapsedOutput) this.elapsedOutput.textContent = elapsedText;
    if (this.durationOutput) this.durationOutput.textContent = durationText;
    // Legacy exports used data-role="phase". Keep it useful, but never return
    // to a step counter: the scrubber always denotes the complete motion.
    if (this.phaseOutput) this.phaseOutput.textContent = elapsedText + " / " + durationText;

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
