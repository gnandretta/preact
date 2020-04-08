import { enqueueRender } from './component';

export let i = 0;

export function createContext(defaultValue) {
	const ctx = {};

	const context = {
		_id: '__cC' + i++,
		_defaultValue: defaultValue,
		Consumer(props, context) {
			return props.children(context);
		},
		Provider(props) {
			if (!this.getChildContext) {
				const subs = [];
				this.getChildContext = () => {
					ctx[context._id] = this;
					return ctx;
				};

				this.shouldComponentUpdate = _props => {
					if (this.props.value !== _props.value) {
						subs.some(c => {
							c[0].context = _props.value;
							if (!c[1] || c[1](_props.value, this.props.value)) {
								enqueueRender(c[0]);
							}
						});
					}
				};

				this.sub = (c, shouldUpdate) => {
					const entry = [c, shouldUpdate];
					subs.push(entry);
					let old = c.componentWillUnmount;
					c.componentWillUnmount = () => {
						subs.splice(subs.indexOf(entry), 1);
						old && old.call(c);
					};
				};
			}

			return props.children;
		}
	};

	context.Consumer.contextType = context;

	return context;
}
