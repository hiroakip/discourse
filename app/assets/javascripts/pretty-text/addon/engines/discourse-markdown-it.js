import AllowLister from "pretty-text/allow-lister";
import { cloneJSON } from "discourse-common/lib/object";
import deprecated from "discourse-common/lib/deprecated";
import guid from "pretty-text/guid";
import { sanitize } from "pretty-text/sanitizer";

export const ATTACHMENT_CSS_CLASS = "attachment";

function deprecate(feature, name) {
  return function () {
    if (window.console && window.console.log) {
      window.console.log(
        feature +
          ": " +
          name +
          " is deprecated, please use the new markdown it APIs"
      );
    }
  };
}

function createHelper(
  featureName,
  opts,
  optionCallbacks,
  pluginCallbacks,
  customMarkdownEngineCallbacks,
  getOptions,
  allowListed
) {
  let helper = {};
  helper.markdownIt = true;
  helper.allowList = (info) => allowListed.push([featureName, info]);
  helper.whiteList = (info) => {
    deprecated("`whiteList` has been replaced with `allowList`", {
      since: "2.6.0.beta.4",
      dropFrom: "2.7.0",
    });
    helper.allowList(info);
  };

  helper.registerInline = deprecate(featureName, "registerInline");
  helper.replaceBlock = deprecate(featureName, "replaceBlock");
  helper.addPreProcessor = deprecate(featureName, "addPreProcessor");
  helper.inlineReplace = deprecate(featureName, "inlineReplace");
  helper.postProcessTag = deprecate(featureName, "postProcessTag");
  helper.inlineRegexp = deprecate(featureName, "inlineRegexp");
  helper.inlineBetween = deprecate(featureName, "inlineBetween");
  helper.postProcessText = deprecate(featureName, "postProcessText");
  helper.onParseNode = deprecate(featureName, "onParseNode");
  helper.registerBlock = deprecate(featureName, "registerBlock");
  // hack to allow moving of getOptions
  helper.getOptions = () => getOptions.f();

  helper.registerOptions = (callback) => {
    optionCallbacks.push([featureName, callback]);
  };

  helper.registerPlugin = (callback) => {
    pluginCallbacks.push([featureName, callback]);
  };

  helper.buildCustomMarkdownEngine = (callback) => {
    customMarkdownEngineCallbacks.push([featureName, callback]);
  };

  return helper;
}

// TODO we may just use a proper ruler from markdown it... this is a basic proxy
class Ruler {
  constructor() {
    this.rules = [];
  }

  getRules() {
    return this.rules;
  }

  getRuleForTag(tag) {
    this.ensureCache();
    if (this.cache.hasOwnProperty(tag)) {
      return this.cache[tag];
    }
  }

  ensureCache() {
    if (this.cache) {
      return;
    }

    this.cache = {};
    for (let i = this.rules.length - 1; i >= 0; i--) {
      let info = this.rules[i];
      this.cache[info.rule.tag] = info;
    }
  }

  push(name, rule) {
    this.rules.push({ name, rule });
    this.cache = null;
  }
}

// block bb code ruler for parsing of quotes / code / polls
function setupBlockBBCode(md) {
  md.block.bbcode = { ruler: new Ruler() };
}

function setupInlineBBCode(md) {
  md.inline.bbcode = { ruler: new Ruler() };
}

function setupTextPostProcessRuler(md) {
  const TextPostProcessRuler = requirejs(
    "pretty-text/engines/discourse-markdown/text-post-process"
  ).TextPostProcessRuler;
  md.core.textPostProcess = { ruler: new TextPostProcessRuler() };
}

function renderHoisted(tokens, idx, options) {
  const content = tokens[idx].content;
  if (content && content.length > 0) {
    let id = guid();
    options.discourse.hoisted[id] = content;
    return id;
  } else {
    return "";
  }
}

function setupUrlDecoding(md) {
  // this fixed a subtle issue where %20 is decoded as space in
  // automatic urls
  md.utils.lib.mdurl.decode.defaultChars = ";/?:@&=+$,# ";
}

function setupHoister(md) {
  md.renderer.rules.html_raw = renderHoisted;
}

export function extractDataAttribute(str) {
  let sep = str.indexOf("=");
  if (sep === -1) {
    return null;
  }

  const key = `data-${str.substr(0, sep)}`.toLowerCase();
  if (!/^[A-Za-z]+[\w\-\:\.]*$/.test(key)) {
    return null;
  }

  const value = str.substr(sep + 1);
  return [key, value];
}

// videoHTML and audioHTML follow the same HTML syntax
// as oneboxer.rb when dealing with these formats
function videoHTML(token) {
  const src = token.attrGet("src");
  const origSrc = token.attrGet("data-orig-src");
  const dataOrigSrcAttr = origSrc !== null ? `data-orig-src="${origSrc}"` : "";
  return `<div class="video-container">
    <video width="100%" height="100%" preload="metadata" controls>
      <source src="${src}" ${dataOrigSrcAttr}>
      <a href="${src}">${src}</a>
    </video>
  </div>`;
}

function audioHTML(token) {
  const src = token.attrGet("src");
  const origSrc = token.attrGet("data-orig-src");
  const dataOrigSrcAttr = origSrc !== null ? `data-orig-src="${origSrc}"` : "";
  return `<audio preload="metadata" controls>
    <source src="${src}" ${dataOrigSrcAttr}>
    <a href="${src}">${src}</a>
  </audio>`;
}

const IMG_SIZE_REGEX = /^([1-9]+[0-9]*)x([1-9]+[0-9]*)(\s*,\s*(x?)([1-9][0-9]{0,2}?)([%x]?))?$/;
function renderImageOrPlayableMedia(tokens, idx, options, env, slf) {
  const token = tokens[idx];
  const alt = slf.renderInlineAsText(token.children, options, env);
  const split = alt.split("|");
  const altSplit = [split[0]];

  // markdown-it supports returning HTML instead of continuing to render the current token
  // see https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md#renderer
  // handles |video and |audio alt transformations for image tags
  if (split[1] === "video") {
    if (
      options.discourse.previewing &&
      !options.discourse.limitedSiteSettings.enableDiffhtmlPreview
    ) {
      return `<div class="onebox-placeholder-container">
        <span class="placeholder-icon video"></span>
      </div>`;
    } else {
      return videoHTML(token);
    }
  } else if (split[1] === "audio") {
    return audioHTML(token);
  }

  // parsing ![myimage|500x300]() or ![myimage|75%]() or ![myimage|500x300, 75%]
  for (let i = 1, match, data; i < split.length; ++i) {
    if ((match = split[i].match(IMG_SIZE_REGEX)) && match[1] && match[2]) {
      let width = match[1];
      let height = match[2];

      // calculate using percentage
      if (match[5] && match[6] && match[6] === "%") {
        let percent = parseFloat(match[5]) / 100.0;
        width = parseInt(width * percent, 10);
        height = parseInt(height * percent, 10);
      }

      // calculate using only given width
      if (match[5] && match[6] && match[6] === "x") {
        let wr = parseFloat(match[5]) / width;
        width = parseInt(match[5], 10);
        height = parseInt(height * wr, 10);
      }

      // calculate using only given height
      if (match[5] && match[4] && match[4] === "x" && !match[6]) {
        let hr = parseFloat(match[5]) / height;
        height = parseInt(match[5], 10);
        width = parseInt(width * hr, 10);
      }

      if (token.attrIndex("width") === -1) {
        token.attrs.push(["width", width]);
      }

      if (token.attrIndex("height") === -1) {
        token.attrs.push(["height", height]);
      }

      if (
        options.discourse.previewing &&
        match[6] !== "x" &&
        match[4] !== "x"
      ) {
        token.attrs.push(["class", "resizable"]);
      }
    } else if ((data = extractDataAttribute(split[i]))) {
      token.attrs.push(data);
    } else if (split[i] === "thumbnail") {
      token.attrs.push(["data-thumbnail", "true"]);
    } else {
      altSplit.push(split[i]);
    }
  }

  token.attrs[token.attrIndex("alt")][1] = altSplit.join("|");
  return slf.renderToken(tokens, idx, options);
}

// we have taken over the ![]() syntax in markdown to
// be able to render a video or audio URL as well as the
// image using |video and |audio in the text inside []
function setupImageAndPlayableMediaRenderer(md) {
  md.renderer.rules.image = renderImageOrPlayableMedia;
}

function renderAttachment(tokens, idx, options, env, slf) {
  const linkToken = tokens[idx];
  const textToken = tokens[idx + 1];

  const split = textToken.content.split("|");
  const contentSplit = [];

  for (let i = 0, data; i < split.length; ++i) {
    if (split[i] === ATTACHMENT_CSS_CLASS) {
      linkToken.attrs.unshift(["class", split[i]]);
    } else if ((data = extractDataAttribute(split[i]))) {
      linkToken.attrs.push(data);
    } else {
      contentSplit.push(split[i]);
    }
  }

  if (contentSplit.length > 0) {
    textToken.content = contentSplit.join("|");
  }

  return slf.renderToken(tokens, idx, options);
}

function setupAttachments(md) {
  md.renderer.rules.link_open = renderAttachment;
}

let Helpers;

export function setup(opts, siteSettings, state) {
  if (opts.setup) {
    return;
  }

  // we got to require this late cause bundle is not loaded in pretty-text
  Helpers =
    Helpers || requirejs("pretty-text/engines/discourse-markdown/helpers");

  opts.markdownIt = true;

  let optionCallbacks = [];
  let pluginCallbacks = [];
  let customMarkdownEngineCallbacks = [];

  // ideally I would like to change the top level API a bit, but in the mean time this will do
  let getOptions = {
    f: () => opts,
  };

  const check = /discourse-markdown\/|markdown-it\//;
  let features = [];
  let allowListed = [];

  Object.keys(require._eak_seen).forEach((entry) => {
    if (check.test(entry)) {
      const module = requirejs(entry);
      if (module && module.setup) {
        const id = entry.split("/").reverse()[0];
        let priority = module.priority || 0;
        features.unshift({ id, setup: module.setup, priority });
      }
    }
  });

  features
    .sort((a, b) => a.priority - b.priority)
    .forEach((f) => {
      f.setup(
        createHelper(
          f.id,
          opts,
          optionCallbacks,
          pluginCallbacks,
          customMarkdownEngineCallbacks,
          getOptions,
          allowListed
        )
      );
    });

  Object.entries(state.allowListed || {}).forEach((entry) => {
    allowListed.push(entry);
  });

  optionCallbacks.forEach(([, callback]) => {
    callback(opts, siteSettings, state);
  });

  // enable all features by default
  features.forEach((feature) => {
    if (!opts.features.hasOwnProperty(feature.id)) {
      opts.features[feature.id] = true;
    }
  });

  if (opts.featuresOverride) {
    Object.keys(opts.features).forEach((feature) => {
      opts.features[feature] = opts.featuresOverride.includes(feature);
    });
  }

  let copy = {};
  Object.keys(opts).forEach((entry) => {
    copy[entry] = opts[entry];
    delete opts[entry];
  });

  copy.helpers = {
    textReplace: Helpers.textReplace,
  };

  opts.discourse = copy;
  getOptions.f = () => opts.discourse;

  opts.discourse.limitedSiteSettings = {
    secureMedia: siteSettings.secure_media,
    enableDiffhtmlPreview: siteSettings.enable_diffhtml_preview,
    traditionalMarkdownLinebreaks: siteSettings.traditional_markdown_linebreaks,
    enableMarkdownLinkify: siteSettings.enable_markdown_linkify,
    enableMarkdownTypographer: siteSettings.enable_markdown_typographer,
    markdownTypographerQuotationMarks:
      siteSettings.markdown_typographer_quotation_marks,
    markdownLinkifyTlds: siteSettings.markdown_linkify_tlds,
  };

  const markdownitOpts = {
    discourse: opts.discourse,
    html: true,
    breaks: !opts.discourse.limitedSiteSettings.traditionalMarkdownLinebreaks,
    xhtmlOut: false,
    linkify: opts.discourse.limitedSiteSettings.enableMarkdownLinkify,
    typographer: opts.discourse.limitedSiteSettings.enableMarkdownTypographer,
  };

  if (opts.discourse.markdownItRules !== undefined) {
    opts.engine = zeroRuleMarkdownEngine(
      markdownitOpts,
      opts.discourse.markdownItRules
    );
  } else {
    opts.engine = window.markdownit(markdownitOpts);
  }

  opts.pluginCallbacks = pluginCallbacks;
  opts.allowListed = allowListed;

  setupMarkdownEngine(opts, opts.discourse.features);

  customMarkdownEngineCallbacks.forEach(([, callback]) => {
    callback((engineOpts, afterBuild) =>
      afterBuild(buildCustomMarkdownEngine(engineOpts, opts))
    );
  });
}

function buildCustomMarkdownEngine(engineOpts, defaultEngineOpts) {
  engineOpts.featuresOverride = engineOpts.featuresOverride || [];
  engineOpts.markdownItRules = engineOpts.markdownItRules || [];

  // everything except the engine for opts can just point to the other
  // opts references, they do not change and we don't need to worry about
  // mutating them
  const newOpts = {};
  newOpts.allowListed = defaultEngineOpts.allowListed;
  newOpts.pluginCallbacks = defaultEngineOpts.pluginCallbacks;
  newOpts.sanitizer = defaultEngineOpts.sanitizer;
  newOpts.discourse = {};
  const featureConfig = cloneJSON(defaultEngineOpts.discourse.features);

  // everything from the discourse part of defaultEngineOpts can be cloned except
  // the features, because these can be a limited subset and we
  // don't want to change the original object reference
  for (const [key, value] of Object.entries(defaultEngineOpts.discourse)) {
    if (key !== "features") {
      newOpts.discourse[key] = value;
    }
  }

  Object.keys(featureConfig).forEach((feature) => {
    featureConfig[feature] = engineOpts.featuresOverride.includes(feature);
  });
  newOpts.discourse.features = featureConfig;

  const markdownitOpts = {
    discourse: newOpts.discourse,
    html: defaultEngineOpts.engine.options.html,
    breaks: defaultEngineOpts.engine.options.breaks,
    xhtmlOut: defaultEngineOpts.engine.options.xhtmlOut,
    linkify: defaultEngineOpts.engine.options.linkify,
    typographer: defaultEngineOpts.engine.options.typographer,
  };
  if (engineOpts.markdownItRules.length > 0) {
    newOpts.engine = zeroRuleMarkdownEngine(
      markdownitOpts,
      engineOpts.markdownItRules
    );
  } else {
    newOpts.engine = window.markdownit(markdownitOpts);
  }

  // we have to do this again to make sure plugin callbacks
  // are run etc.
  setupMarkdownEngine(newOpts, featureConfig);

  // we don't need the whole engine as a consumer, just a cook function
  // will do
  return function customRenderFn(contentToRender) {
    return newOpts.discourse
      .sanitizer(newOpts.engine.render(contentToRender))
      .trim();
  };
}

function setupMarkdownEngine(opts, featureConfig) {
  const quotation_marks =
    opts.discourse.limitedSiteSettings.markdownTypographerQuotationMarks;
  if (quotation_marks) {
    opts.engine.options.quotes = quotation_marks.split("|");
  }

  opts.engine.linkify.tlds(
    (opts.discourse.limitedSiteSettings.markdownLinkifyTlds || "").split("|")
  );

  setupUrlDecoding(opts.engine);
  setupHoister(opts.engine);
  setupImageAndPlayableMediaRenderer(opts.engine);
  setupAttachments(opts.engine);
  setupBlockBBCode(opts.engine);
  setupInlineBBCode(opts.engine);
  setupTextPostProcessRuler(opts.engine);

  opts.pluginCallbacks.forEach(([feature, callback]) => {
    if (featureConfig[feature]) {
      opts.engine.use(callback);
    }
  });

  // top level markdown it notifier
  opts.markdownIt = true;
  opts.setup = true;

  if (!opts.discourse.sanitizer || !opts.sanitizer) {
    const allowLister = new AllowLister(opts.discourse);

    opts.allowListed.forEach(([feature, info]) => {
      allowLister.allowListFeature(feature, info);
    });

    opts.sanitizer = opts.discourse.sanitizer = !!opts.discourse.sanitize
      ? (a) => sanitize(a, allowLister)
      : (a) => a;
  }
}

function zeroRuleMarkdownEngine(markdownitOpts, markdownItRuleSubset) {
  // Preset for "zero", https://github.com/markdown-it/markdown-it/blob/master/lib/presets/zero.js
  return window.markdownit("zero", markdownitOpts).enable(markdownItRuleSubset);
}

export function cook(raw, opts) {
  // we still have to hoist html_raw nodes so they bypass the allowlister
  // this is the case for oneboxes
  let hoisted = {};

  opts.discourse.hoisted = hoisted;

  const rendered = opts.engine.render(raw);
  let cooked = opts.discourse.sanitizer(rendered).trim();

  const keys = Object.keys(hoisted);
  if (keys.length) {
    let found = true;

    const unhoist = function (key) {
      cooked = cooked.replace(new RegExp(key, "g"), function () {
        found = true;
        return hoisted[key];
      });
    };

    while (found) {
      found = false;
      keys.forEach(unhoist);
    }
  }

  delete opts.discourse.hoisted;
  return cooked;
}
