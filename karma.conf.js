/*eslint no-var:0, object-shorthand:0 */

var coverage = String(process.env.COVERAGE) === 'true',
	minify = String(process.env.MINIFY) === 'true',
	ci = String(process.env.CI).match(/^(1|true)$/gi),
	pullRequest = String(process.env.GITHUB_EVENT_NAME) === 'pull_request',
	masterBranch = String(process.env.GITHUB_WORKFLOW) === 'CI-master',
	sauceLabs = ci && !pullRequest && masterBranch,
	performance = !coverage && String(process.env.PERFORMANCE) !== 'false',
	path = require('path'),
	errorstacks = require('errorstacks'),
	kl = require('kolorist');

const babel = require('@babel/core');
const fs = require('fs').promises;

// This strips Karma's annoying `LOG: '...'` string from logs
const orgStdoutWrite = process.stdout.write;
process.stdout.write = msg => {
	let out = '';
	const match = msg.match(/(^|.*\s)(LOG|WARN|ERROR):\s'([\s\S]*)'/);
	if (match && match.length >= 4) {
		// Sometimes the UA of the browser will be included in the message
		if (match[1].length) {
			out += kl.yellow(kl.italic(match[1]));
			out += match[3]
				.split('\n')
				.map(line => '  ' + line)
				.join('\n');
		} else {
			out += match[3];
		}
		out += '\n';
	} else {
		out = msg;
	}

	return orgStdoutWrite.call(process.stdout, out);
};

var sauceLabsLaunchers = {
	sl_chrome: {
		base: 'SauceLabs',
		browserName: 'chrome',
		platform: 'Windows 10'
	},
	sl_firefox: {
		base: 'SauceLabs',
		browserName: 'firefox',
		platform: 'Windows 10'
	},
	// TODO: Safari always fails and disconnects before any tests are executed.
	// This seems to be an issue with Saucelabs and they're actively investigating
	// that (see: https://mobile.twitter.com/bromann/status/1136323458328084482).
	// We'll disable Safari for now until that's resolved.
	// sl_safari: {
	// 	base: 'SauceLabs',
	// 	browserName: 'Safari',
	// 	version: '11',
	// 	platform: 'OS X 10.13'
	// },
	sl_edge: {
		base: 'SauceLabs',
		browserName: 'MicrosoftEdge',
		platform: 'Windows 10'
	},
	sl_ie_11: {
		base: 'SauceLabs',
		browserName: 'internet explorer',
		version: '11.0',
		platform: 'Windows 7'
	}
};

var localLaunchers = {
	ChromeNoSandboxHeadless: {
		base: 'Chrome',
		flags: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			// See https://chromium.googlesource.com/chromium/src/+/lkgr/headless/README.md
			'--headless',
			'--disable-gpu',
			'--no-gpu',
			// Without a remote debugging port, Google Chrome exits immediately.
			'--remote-debugging-port=9333'
		]
	}
};

const subPkgPath = pkgName => {
	const parts = !minify ? ['src', 'index.js'] : [];
	return path.join(__dirname, pkgName, ...parts);
};

const pending = new Map();
const cache = new Map();

module.exports = function(config) {
	config.set({
		browsers: sauceLabs
			? Object.keys(sauceLabsLaunchers)
			: Object.keys(localLaunchers),

		frameworks: ['mocha', 'chai-sinon'],

		reporters: ['mocha'].concat(
			coverage ? 'coverage' : [],
			sauceLabs ? 'saucelabs' : []
		),

		formatError(msg) {
			const frames = errorstacks.parseStackTrace(msg);
			if (!frames.length || frames[0].column === -1) return '\n' + msg + '\n';

			const frame = frames[0];
			const filePath = kl.lightCyan(frame.fileName.replace('webpack:///', ''));

			const indentMatch = msg.match(/^(\s*)/);
			const indent = indentMatch ? indentMatch[1] : '  ';
			const location = kl.yellow(`:${frame.line}:${frame.column}`);
			return `${indent}at ${frame.name} (${filePath}${location})\n`;
		},

		coverageReporter: {
			dir: path.join(__dirname, 'coverage'),
			reporters: [
				{ type: 'text-summary' },
				{ type: 'html' },
				{ type: 'lcovonly', subdir: '.', file: 'lcov.info' }
			]
		},

		mochaReporter: {
			showDiff: true
		},

		browserLogOptions: { terminal: true },
		browserConsoleLogOptions: { terminal: true },

		browserNoActivityTimeout: 5 * 60 * 1000,

		// Use only two browsers concurrently, works better with open source Sauce Labs remote testing
		concurrency: 2,

		captureTimeout: 0,

		sauceLabs: {
			build: `CI #${process.env.GITHUB_RUN_NUMBER} (${process.env.GITHUB_RUN_ID})`,
			tunnelIdentifier:
				process.env.GITHUB_RUN_NUMBER ||
				`local${require('./package.json').version}`,
			connectLocationForSERelay: 'localhost',
			connectPortForSERelay: 4445,
			startConnect: !!sauceLabs
		},

		customLaunchers: sauceLabs ? sauceLabsLaunchers : localLaunchers,

		files: [
			{ pattern: 'test/polyfills.js', watched: false },
			{
				pattern:
					config.grep ||
					'{debug,hooks,compat,test-utils,jsx-runtime,}/test/{browser,shared}/**/*.test.jsx',
				watched: false,
				type: 'js'
			}
		],

		mime: {
			'text/javascript': ['js', 'jsx']
		},

		preprocessors: {
			'{debug,hooks,compat,test-utils,jsx-runtime,}/test/**/*': [
				'esbuild',
				'sourcemap'
			]
		},

		esbuild: {
			define: {
				COVERAGE: coverage,
				'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || ''),
				ENABLE_PERFORMANCE: performance
			},
			jsxFactory: 'createElement',
			jsxFragment: 'Fragment',
			plugins: [
				{
					name: 'alias',
					setup(build) {
						const alias = {
							'preact/debug': subPkgPath('./debug/'),
							'preact/devtools': subPkgPath('./devtools/'),
							'preact/compat': subPkgPath('./compat/'),
							'preact/hooks': subPkgPath('./hooks/'),
							'preact/test-utils': subPkgPath('./test-utils/'),
							'preact/jsx-runtime': subPkgPath('./jsx-runtime/'),
							'preact/jsx-dev-runtime': subPkgPath('./jsx-runtime/'),
							preact: subPkgPath('')
						};

						build.onResolve({ filter: /^preact.*/ }, args => {
							const pkg = alias[args.path];
							return {
								path: pkg,
								namespace: 'preact'
							};
						});

						const rename = {};
						const mangle = require('./mangle.json');
						for (let prop in mangle.props.props) {
							let name = prop;
							if (name[0] === '$') {
								name = name.slice(1);
							}

							rename[name] = mangle.props.props[prop];
						}

						build.onLoad({ filter: /\.jsx?$/ }, async args => {
							const contents = await fs.readFile(args.path, 'utf-8');

							const cached = cache.get(args.path);
							if (cached && cached.input === contents) {
								return {
									contents: cached.result,
									resolveDir: path.dirname(args.path),
									loader: args.path.endsWith('jsx') ? 'jsx' : 'js'
								};
							}

							let result = contents;

							if (!pending.has(args.path)) {
								pending.set(args.path, []);

								const tmp = await babel.transformAsync(result, {
									filename: args.path,
									plugins: [
										coverage && [
											'istanbul',
											{
												include: minify
													? ['**/dist/**/*.js', '**/dist/**/*.jsx']
													: ['**/src/**/*.js', '**/src/**/*.jsx']
											}
										]
									].filter(Boolean)
								});
								result = tmp.code || result;
								cache.set(args.path, { input: contents, result });

								const waited = pending.get(args.path);
								pending.delete(args.path);
								waited.forEach(fn => fn());
							} else {
								await new Promise(r => {
									pending.get(args.path).push(r);
								});
								result = cache.get(args.path).result;
							}

							return {
								contents: result,
								resolveDir: path.dirname(args.path),
								loader: args.path.endsWith('.jsx') ? 'jsx' : 'js'
							};
						});
					}
				}
			]
		}
	});
};
