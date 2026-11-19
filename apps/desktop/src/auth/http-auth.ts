// HTTP sign-in page for the built-in browser. It has no preload and no IPC:
// main calls `prepareSignIn` with plain text, then waits for `signInResult`.
// Text goes in through textContent only, never as HTML.
type Challenge = { host: string; proxy: boolean; secure: boolean };
type Credentials = { username: string; password: string };

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let settle: (value: Credentials | null) => void = () => undefined;
const result = new Promise<Credentials | null>(resolve => { settle = resolve; });

/** Fills in the text and returns the page height in CSS pixels. */
function prepareSignIn(challenge: Challenge): number {
  element('message').textContent = challenge.proxy
    ? `The proxy ${challenge.host} requires a username and password.`
    : `${challenge.host} requires a username and password.`;
  element('warning').hidden = challenge.proxy || challenge.secure;
  element<HTMLInputElement>('username').focus();
  return Math.ceil(element('form').getBoundingClientRect().height);
}

element('form').addEventListener('submit', event => {
  event.preventDefault();
  settle({ username: element<HTMLInputElement>('username').value, password: element<HTMLInputElement>('password').value });
});
element('cancel').addEventListener('click', () => settle(null));
document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); settle(null); } });

Object.assign(window, { prepareSignIn, signInResult: result });
