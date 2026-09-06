'use strict';

const { version: OAS_VERSION } = require('../../package.json');

const COMMUNITY_LINKS = Object.freeze({
  github: 'https://github.com/neal0709/Operating-Agent-system-',
  discord: 'https://discord.gg/36yGMHGFbR',
  documentation: 'https://github.com/neal0709/Operating-Agent-system-#readme',
  githubApp: 'https://github.com/apps/oas-tools',
});

const SUCCESS_ACTIONS = Object.freeze([
  'installed',
  'updated',
  'migrated',
  'resumed',
  'already-migrated',
  'configured',
]);
const SUCCESS_MESSAGES = Object.freeze({
  installed: 'Welcome to OAS!',
  updated: 'OAS is updated — thank you for using OAS!',
  migrated: 'OAS is configured — thank you for using OAS!',
  resumed: 'OAS is configured — thank you for using OAS!',
  'already-migrated': 'OAS is configured — thank you for using OAS!',
  configured: 'OAS is configured — thank you for using OAS!',
});
// CFonts' default "block" face: https://github.com/dominikwilkowski/cfonts
const OAS_WORDMARK = Object.freeze([
  ' ███████╗  ██████╗  ██████╗',
  ' ██╔════╝ ██╔════╝ ██╔════╝',
  ' █████╗   ██║      ██║',
  ' ██╔══╝   ██║      ██║',
  ' ███████╗ ╚██████╗ ╚██████╗',
  ' ╚══════╝  ╚═════╝  ╚═════╝',
]);
const OAS_GRADIENT = Object.freeze({
  start: Object.freeze({ red: 215, green: 151, blue: 107 }),
  end: Object.freeze({ red: 100, green: 131, blue: 160 }),
});
const OAS_VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const WORDMARK_START_COLUMN = Math.min(...OAS_WORDMARK.map(line => line.search(/\S/)));
const WORDMARK_END_COLUMN = Math.max(
  ...OAS_WORDMARK.map(line => line.trimEnd().length - 1)
);

function colorize(value, code, enabled) {
  return enabled ? `\x1b[${code}m${value}\x1b[0m` : value;
}

function interpolateChannel(start, end, ratio) {
  return Math.round(start + ((end - start) * ratio));
}

function gradientColorAt(column) {
  const span = WORDMARK_END_COLUMN - WORDMARK_START_COLUMN;
  const ratio = span === 0 ? 0 : (column - WORDMARK_START_COLUMN) / span;
  return {
    red: interpolateChannel(OAS_GRADIENT.start.red, OAS_GRADIENT.end.red, ratio),
    green: interpolateChannel(OAS_GRADIENT.start.green, OAS_GRADIENT.end.green, ratio),
    blue: interpolateChannel(OAS_GRADIENT.start.blue, OAS_GRADIENT.end.blue, ratio),
  };
}

function renderWordmark(color) {
  if (!color) return OAS_WORDMARK.join('\n');

  return OAS_WORDMARK.map(line => (
    [...line].map((character, column) => {
      if (character === ' ') return character;
      const value = gradientColorAt(column);
      return `\x1b[38;2;${value.red};${value.green};${value.blue}m${character}`;
    }).join('') + '\x1b[0m'
  )).join('\n');
}

function renderCommunityLinks() {
  const rows = Object.freeze([
    `GitHub:        ${COMMUNITY_LINKS.github}`,
    `Discord:       ${COMMUNITY_LINKS.discord}`,
    `Documentation: ${COMMUNITY_LINKS.documentation}`,
    `GitHub App:     ${COMMUNITY_LINKS.githubApp}`,
  ]);
  const contentWidth = Math.max(...rows.map(row => row.length));
  const border = '─'.repeat(contentWidth + 2);

  return [
    `  ╭${border}╮`,
    ...rows.map(row => `  │ ${row.padEnd(contentWidth)} │`),
    `  ╰${border}╯`,
  ];
}

function renderTerminalWelcome(options = {}) {
  const color = options.color === true;
  const installedVersion = options.version || OAS_VERSION;
  if (!OAS_VERSION_PATTERN.test(installedVersion)) {
    throw new Error(`Invalid OAS version: ${installedVersion}`);
  }
  const graphic = renderWordmark(color);
  const successMessage = SUCCESS_MESSAGES[options.action] || SUCCESS_MESSAGES.installed;
  const welcomeMessage = colorize(successMessage, '1;35', color);
  const version = colorize(`v${installedVersion}`, '2', color);
  const versionLine = color ? `\x1b[1G  ${version}` : `  ${version}`;

  return [
    '',
    graphic,
    '',
    `  ${welcomeMessage}`,
    versionLine,
    '',
    ...renderCommunityLinks(),
    '',
  ].join('\n');
}

function showTerminalWelcome(options = {}) {
  const {
    action,
    dryRun = false,
    env = process.env,
    interactive = false,
    json = false,
    output = process.stdout,
  } = options;
  const shouldShow = (
    interactive
    && output.isTTY === true
    && !dryRun
    && !json
    && SUCCESS_ACTIONS.includes(action)
  );
  if (!shouldShow) return false;

  const color = env.NO_COLOR === undefined && env.TERM !== 'dumb';
  output.write(renderTerminalWelcome({ action, color }));
  return true;
}

module.exports = {
  COMMUNITY_LINKS,
  OAS_VERSION_PATTERN,
  renderTerminalWelcome,
  showTerminalWelcome,
};
