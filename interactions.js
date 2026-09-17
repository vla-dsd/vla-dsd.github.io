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

  function phaseDefinition(storyName, progress, mode) {
    var phases;

    if (storyName === "normalization") {
      phases = [
        [0.15, "Same physical action"],
        [0.52, "Apply dataset statistics"],
        [0.78, "Different normalized values"],
        [1.01, "Same quantizer, different bins"]
      ];
    } else if (storyName === "transfer") {
      phases = [
        [0.20, "Learn in Bridge"],
        [0.45, "Predict action tokens"],
        [0.76, "Decode with Berkeley UR5 statistics"],
        [0.93, mode === "dsd" ? "Direction remains fixed" : "Motion direction changes"],
        [1.01, mode === "dsd" ? "Direction preserved; magnitude may change" : "69.84\u00b0 3-D direction change"]
      ];
    } else {
      phases = [
        [0.18, "Same geometric path"],
        [0.72, "Different step sizes"],
        [0.90, "Tokenize each step"],
        [1.01, "Same path, different motion tokens"]
      ];
    }

    for (var index = 0; index < phases.length; index += 1) {
      if (progress < phases[index][0]) {
        return { index: index, text: phases[index][1], total: phases.length };
      }
    }
    return { index: phases.length - 1, text: phases[phases.length - 1][1], total: phases.length };
  }

  function positionOnPath(dot, path, progress) {
    if (!dot || !path || typeof path.getTotalLength !== "function" || typeof path.getPointAtLength !== "function") {
      return;
    }

    try {
      var point = path.getPointAtLength(path.getTotalLength() * clamp(progress, 0, 1));
      var tag = String(dot.tagName || "").toLowerCase();
      if (tag === "circle" || tag === "ellipse") {
        dot.setAttribute("cx", String(point.x));
        dot.setAttribute("cy", String(point.y));
      } else {
        dot.setAttribute("transform", "translate(" + point.x + " " + point.y + ")");
      }
    } catch (_error) {
      // A malformed optional SVG path must not disable the rest of the page.
    }
  }

  function preserveFinalText(node, fallback) {
    if (!node.dataset.finalText) {
      node.dataset.finalText = node.dataset.value || node.textContent.trim() || fallback;
    }
    return node.dataset.finalText;
  }

  function tokenNumbers(text) {
    return (String(text || "").match(/\d+/g) || []).map(Number);
  }

  function dynamicFastTokenText(controller, fallback) {
    var slow = controller.speedSlowTokens;
    var fast = controller.speedFastTokens;
    if (!slow || !fast || slow.length !== fast.length || !slow.length) return fallback;
    var denominator = controller.defaultSpeedFactor - 1;
    var ratio = denominator === 0 ? 1 : (controller.speedFactor - 1) / denominator;
    return slow.map(function (token, index) {
      return "#" + Math.round(clamp(token + (fast[index] - token) * ratio, 0, 255));
    }).join(" \u00b7 ");
  }

  function renderSpeed(controller, progress) {
    var article = controller.article;
    var travel = smoothstep((progress - 0.10) / 0.64);
    var slowProgress = clamp(travel, 0, 1);
    var speedFactor = controller.speedFactor || 1.6;
    var fastProgress = clamp(travel * speedFactor, 0, 1);

    article.style.setProperty("--slow-progress", slowProgress.toFixed(4));
    article.style.setProperty("--fast-progress", fastProgress.toFixed(4));
    article.style.setProperty("--speed-factor", speedFactor.toFixed(2));

    var slowDot = article.querySelector('[data-role="speed-slow-dot"]');
    var fastDot = article.querySelector('[data-role="speed-fast-dot"]');
    var slowPath = article.querySelector('[data-role="slow-path"]');
    var fastPath = article.querySelector('[data-role="fast-path"]') || slowPath;
    positionOnPath(slowDot, slowPath, slowProgress);
    positionOnPath(fastDot, fastPath, fastProgress);

    var tokenReveal = smoothstep((progress - 0.68) / 0.22);
    article.style.setProperty("--token-progress", tokenReveal.toFixed(4));

    roleNodes(article, ["speed-slow-token", "slow-token"]).forEach(function (node) {
      var finalText = preserveFinalText(node, "small-step bin");
      node.textContent = tokenReveal < 0.08 ? "\u2026" : finalText;
      node.dataset.visible = tokenReveal > 0.08 ? "true" : "false";
    });
    roleNodes(article, ["speed-fast-token", "fast-token"]).forEach(function (node) {
      var finalText = preserveFinalText(node, "large-step bin");
      node.textContent = tokenReveal < 0.08 ? "\u2026" : dynamicFastTokenText(controller, finalText);
      node.dataset.visible = tokenReveal > 0.08 ? "true" : "false";
    });

    setRoleText(article, ["speed-slow-progress"], Math.round(slowProgress * 100) + "%");
    setRoleText(article, ["speed-fast-progress"], Math.round(fastProgress * 100) + "%");
    setRoleText(article, ["speed-fast-value", "speed-factor-value"], speedFactor.toFixed(1) + "\u00d7");
  }

  function renderNormalization(controller, progress) {
    var article = controller.article;
    var mix = clamp((progress - 0.15) / 0.63, 0, 1);
    var normalizedValue = lerp(0.15, 0.88, mix);
    var bin = clamp(Math.floor(((normalizedValue + 1) / 2) * 256), 0, 255);
    var position = ((normalizedValue + 1) / 2) * 100;

    article.style.setProperty("--stats-mix", mix.toFixed(4));
    article.style.setProperty("--normalized-value", normalizedValue.toFixed(4));
    article.style.setProperty("--normalization-position", position.toFixed(2) + "%");
    article.style.setProperty("--norm-position", position.toFixed(2) + "%");
    article.style.setProperty("--bin-index", String(bin));

    if (controller.statsInput && !controller.statsPointerActive) {
      setRangeFraction(controller.statsInput, mix);
    }
    if (controller.statsInput) {
      controller.statsInput.setAttribute(
        "aria-valuetext",
        "Normalized value " + normalizedValue.toFixed(2) + ", zero-indexed bin " + bin + " of 256"
      );
    }

    setRoleText(article, ["normalization-value", "normalized-value", "norm-value", "stats-value"], normalizedValue.toFixed(2));
    setRoleText(article, ["normalization-bin", "norm-bin", "stats-bin"], String(bin));
    setRoleText(article, ["normalization-bin-label", "norm-bin-label"], "bin " + bin);
  }

  function renderTransfer(controller, progress) {
    var article = controller.article;
    var mode = controller.mode || "raw";
    var change = smoothstep((progress - 0.58) / 0.35);
    var angle = mode === "dsd" ? 0 : 69.84 * change;
    var source = [2.90, -4.60, 3.40];
    var target = [2.18, -2.02, -2.19];
    var output = source.map(function (value, index) {
      return mode === "dsd" ? value : lerp(value, target[index], change);
    });

    article.dataset.mode = mode;
    article.style.setProperty("--transfer-mix", change.toFixed(4));
    article.style.setProperty("--transfer-angle", angle.toFixed(2) + "deg");
    article.style.setProperty("--transfer-angle-value", angle.toFixed(4));
    article.style.setProperty("--transfer-x", output[0].toFixed(4));
    article.style.setProperty("--transfer-y", output[1].toFixed(4));
    article.style.setProperty("--transfer-z", output[2].toFixed(4));
    article.style.setProperty("--mode-dsd", mode === "dsd" ? "1" : "0");
    article.style.setProperty("--target-opacity", mode === "raw" ? change.toFixed(4) : "0");
    article.style.setProperty("--dsd-opacity", mode === "dsd" ? change.toFixed(4) : "0");

    setRoleText(article, ["transfer-angle", "angle-readout"], angle.toFixed(2) + "\u00b0");
    setRoleText(article, ["transfer-summary-label"], mode === "dsd" ? "DSD result" : "Observed mismatch");
    setRoleText(article, ["transfer-angle-suffix"], mode === "dsd" ? " · direction preserved" : " direction change");
    setRoleText(article, ["transfer-source", "source-vector"], formatVector(source));
    setRoleText(article, ["transfer-output", "target-vector"], mode === "dsd" ? "Direction preserved" : formatVector(output));
    setRoleText(
      article,
      ["transfer-result", "transfer-summary"],
      mode === "dsd" ? "Direction preserved; magnitude may change" : angle.toFixed(2) + "\u00b0 3-D direction change"
    );

    var outputVector = article.querySelector('[data-role="transfer-output-vector"]');
    if (outputVector) {
      outputVector.setAttribute("x2", String(lerp(425, 493, change)));
      outputVector.setAttribute("y2", String(lerp(82, 231, change)));
    }
    setRoleText(
      article,
      ["transfer-output-label"],
      mode === "dsd" ? "direction preserved" : "decoded with UR5 stats"
    );
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
    this.statsInput = article.querySelector('input[data-role="stats-mix"]');
    this.speedInput = article.querySelector('input[data-role="speed-factor"]');
    this.modeButtons = Array.prototype.slice.call(article.querySelectorAll('button[data-mode="raw"], button[data-mode="dsd"]'));
    this.progress = this.timeline ? rangeFraction(this.timeline) : 0;
    this.playing = false;
    this.visible = true;
    this.frame = 0;
    this.lastFrameTime = 0;
    this.phaseIndex = -1;
    this.pointerActive = false;
    this.resumeAfterPointer = false;
    this.statsPointerActive = false;
    this.mode = "raw";
    this.speedFactor = this.speedInput ? Number(this.speedInput.value || 160) / 100 : 1.6;
    this.defaultSpeedFactor = this.speedFactor;
    var slowToken = article.querySelector('[data-role="speed-slow-token"], [data-role="slow-token"]');
    var fastToken = article.querySelector('[data-role="speed-fast-token"], [data-role="fast-token"]');
    this.speedSlowTokens = slowToken ? tokenNumbers(slowToken.textContent) : null;
    this.speedFastTokens = fastToken ? tokenNumbers(fastToken.textContent) : null;

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
        controller.pause("scrub");
      });
      this.timeline.addEventListener("input", function () {
        if (!controller.pointerActive) controller.pause("scrub");
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

    if (this.statsInput && this.name === "normalization") {
      this.statsInput.addEventListener("pointerdown", function () {
        controller.statsPointerActive = true;
        controller.pause("scrub");
      });
      this.statsInput.addEventListener("input", function () {
        controller.pause("scrub");
        controller.statsPointerActive = true;
        var mix = rangeFraction(controller.statsInput);
        controller.setProgress(lerp(0.15, 0.78, mix), true);
      });
      ["pointerup", "pointercancel", "change", "blur"].forEach(function (eventName) {
        controller.statsInput.addEventListener(eventName, function () {
          controller.statsPointerActive = false;
          controller.render(true);
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
    if (this.progress >= 1) this.setProgress(0, true);
    if (activeStory && activeStory !== this) activeStory.pause("another-story");
    activeStory = this;
    this.lastFrameTime = 0;
    this.setPlayingState(true);
    this.frame = window.requestAnimationFrame(this.tick.bind(this));
  };

  StoryController.prototype.pause = function (_reason) {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastFrameTime = 0;
    this.setPlayingState(false);
    if (activeStory === this) activeStory = null;
  };

  StoryController.prototype.reset = function () {
    this.pause("reset");
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

  StoryController.prototype.render = function (announce) {
    var progress = clamp(this.progress, 0, 1);
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

    if (this.timeline) {
      this.timeline.setAttribute("aria-valuetext", Math.round(progress * 100) + "% through the explanation");
    }

    if (this.name === "normalization") renderNormalization(this, progress);
    else if (this.name === "transfer") renderTransfer(this, progress);
    else renderSpeed(this, progress);

    var phase = phaseDefinition(this.name, progress, this.mode);
    if (this.phaseOutput && (announce || phase.index !== this.phaseIndex)) {
      this.phaseOutput.textContent = "Step " + (phase.index + 1) + " of " + phase.total + ": " + phase.text;
    }
    this.phaseIndex = phase.index;
    this.article.dataset.phase = String(phase.index + 1);
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
      if (mayAutoplay(video)) safePlay(video);
      else video.pause();
    }

    videos.forEach(function (video) {
      video.autoplay = false;
      video.removeAttribute("autoplay");
      video.muted = true;
      video.playsInline = true;
      video.pause();
      visibility.set(video, false);
    });

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          visibility.set(entry.target, entry.isIntersecting && entry.intersectionRatio >= 0.30);
          updateVideo(entry.target);
        });
      }, { threshold: [0, 0.30, 0.65] });
      videos.forEach(function (video) { observer.observe(video); });
    } else {
      var scheduled = false;
      var checkVisibility = function () {
        scheduled = false;
        videos.forEach(function (video) {
          var rectangle = video.getBoundingClientRect();
          var visibleHeight = Math.min(rectangle.bottom, window.innerHeight) - Math.max(rectangle.top, 0);
          var ratio = rectangle.height > 0 ? clamp(visibleHeight / rectangle.height, 0, 1) : 0;
          visibility.set(video, ratio >= 0.30);
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
