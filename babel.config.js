module.exports = function(api) {
	api.cache(true);

	const minify = String(process.env.MINIFY) === 'true';

	const rename = {};
	const mangle = require('./mangle.json');
	for (let prop in mangle.props.props) {
		let name = prop;
		if (name[0] === '$') {
			name = name.slice(1);
		}

		rename[name] = mangle.props.props[prop];
	}

	return {
		presets: [
			[
				'@babel/preset-env',
				{
					loose: true,
					modules: false,
					exclude: ['@babel/plugin-transform-typeof-symbol'],
					targets: {
						browsers: ['last 2 versions', 'IE >= 9']
					}
				}
			]
		],
		plugins: [
			'@babel/plugin-proposal-object-rest-spread',
			'@babel/plugin-transform-react-jsx',
			'babel-plugin-transform-async-to-promises',
			['babel-plugin-transform-rename-properties', { rename }]
		],
		include: [
			'**/src/**/*.js',
			'**/src/**/*.jsx',
			'**/test/**/*.js',
			'**/test/**/*.jsx'
		],
		overrides: [
			{
				test: /(component-stack|debug)\.test\.jsx?$/,
				plugins: ['@babel/plugin-transform-react-jsx-source']
			}
		]
	};
};
