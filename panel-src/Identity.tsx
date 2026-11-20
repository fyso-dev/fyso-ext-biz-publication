import { DEFAULT_ACCENT, FONTS, previewLook, useDaguAction, useEffect, useRef, useState, useStore, useTranslation,
  type Brand, type Font, type Radius } from '@fyso/panel';
import { PALETTES, backgroundJpeg, base64Utf8, iconPng } from './images';
import markUrl from './assets/fyso-mark.png';

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT_IDS = Object.keys(FONTS) as Font[];
const RADIUS_IDS: Radius[] = ['sharp', 'soft', 'round'];
const BIZ_PROVIDER = 'fyso-biz'; // tinyauth.providers.yaml
// framework/brand/login-background.svg in CSS: the dark surface with the accent's glow from a corner.
const drawnLogin = (accent: string) =>
  `radial-gradient(circle at 15% 0%, ${accent}e6 0%, ${accent}33 50%, transparent 90%), linear-gradient(#0e0e12, #0e0e12)`;

type Session = { authenticated: boolean; providerId: string; name: string; username: string };
type Image = string | null | undefined; // undefined: keep; null: back to the default; string: new (base64)

function Mark({ icon, size }: { icon: string | null | undefined; size: number }) {
  return <img className="id-mark" src={icon ?? markUrl} alt="" width={size} height={size} />;
}

/** Who is signed in, from the native login service (the panel's own source). */
function useSession() {
  const [session, setSession] = useState<Session | null | 'error'>(null);
  useEffect(() => {
    fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw Error(String(r.status)); setSession(((await r.json()) as { auth: Session }).auth); })
      .catch(() => setSession('error'));
  }, []);
  return session;
}

/** The page: the editor is enabled only for a session opened with Fyso Biz. */
export function Identity() {
  const { t } = useTranslation();
  const s = useStore();
  const session = useSession();
  const brand = s.project.data?.brand;
  if (s.mock || session === null || !brand) return <main className="page page-mid"><output className="mute">{t('identity.loading')}</output></main>;
  const biz = session !== 'error' && session.providerId === BIZ_PROVIDER;
  return (
    <main className="page page-mid">
      <div className="page-head">
        <h1>{t('identity.title')}</h1>
      </div>
      <p className="mute">{t('identity.intro')}</p>
      {biz ? <Editor brand={brand} /> : <BizRequired />}
    </main>
  );
}

function BizRequired() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // Signing out returns to the login, where "Fyso Biz" opens a Biz session.
  const switchLogin = async () => {
    setBusy(true);
    try { await fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' }); }
    finally { window.top!.location.reload(); }
  };
  return (
    <section className="card id-locked" aria-labelledby="id-locked-t">
      <span className="id-lock" aria-hidden="true">🔒</span>
      <div className="grow">
        <h2 id="id-locked-t">{t('identity.bizTitle')}</h2>
        <p className="mute">{t('identity.bizBody')}</p>
      </div>
      <button type="button" className="btn btn-pri" disabled={busy} onClick={() => void switchLogin()}>{t('identity.bizSignIn')}</button>
    </section>
  );
}

function Editor({ brand }: { brand: Brand }) {
  const { t } = useTranslation();
  const s = useStore();
  const action = useDaguAction<Brand>(s.backend, 'ext-biz-publication-brand', 'RESULT');
  const [name, setName] = useState(brand.name);
  const [accent, setAccent] = useState(brand.accent);
  const [font, setFont] = useState<Font>(brand.font);
  const [radius, setRadius] = useState<Radius>(brand.radius);
  const [icon, setIcon] = useState<Image>(undefined);
  const [background, setBackground] = useState<Image>(undefined);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const saved = useRef(brand);
  const shownIcon = icon === undefined ? brand.icon : icon === null ? null : `data:image/png;base64,${icon}`;
  const shownBackground = background === undefined ? brand.loginBackground : background === null ? null : `data:image/jpeg;base64,${background}`;
  const validAccent = HEX.test(accent);
  const palette = PALETTES.find((p) => p.accent === accent.toLowerCase());
  const changed = name.trim() !== brand.name || accent.toLowerCase() !== brand.accent || font !== brand.font || radius !== brand.radius
    || icon !== undefined || background !== undefined;

  // Live preview on this page and on the panel around it; leaving the page restores the saved look.
  useEffect(() => { previewLook({ accent: validAccent ? accent : brand.accent, font, radius }); }, [accent, validAccent, font, radius, brand.accent]);
  useEffect(() => () => previewLook(saved.current), []);
  useEffect(() => { saved.current = brand; }, [brand]);

  const busy = saving || action.phase === 'running';
  const save = async () => {
    if (!name.trim()) return setError(t('identity.nameRequired'));
    if (!validAccent) return setError(t('identity.accentInvalid'));
    setSaving(true); setDone(false);
    const send = (input: Record<string, unknown>) => action.start({ OP: 'save', SETTINGS_B64: base64Utf8(JSON.stringify(input)) });
    try {
      // Each image is saved in its own run: one workflow parameter holds at most one of them.
      if (background !== undefined && icon !== undefined && !(await send({ loginBackground: background }))) return;
      const input: Record<string, unknown> = { name: name.trim(), accent, font, radius };
      if (icon !== undefined) input.icon = icon;
      else if (background !== undefined) input.loginBackground = background;
      const result = await send(input);
      if (!result) return;
      saved.current = result;
      setIcon(undefined); setBackground(undefined); setDone(true);
      s.reload();
    } finally { setSaving(false); }
  };
  const pick = async (file: File | undefined, convert: (f: File) => Promise<string>, set: (v: string) => void, fail: string) => {
    if (!file) return;
    try { set(await convert(file)); setError(undefined); setDone(false); }
    catch { setError(t(fail)); }
  };
  const resetAll = () => {
    setName(brand.defaults.name); setAccent(brand.defaults.accent); setFont(brand.defaults.font); setRadius(brand.defaults.radius);
    setIcon(brand.icon ? null : undefined); setBackground(brand.loginBackground ? null : undefined); setDone(false);
  };

  return (
    <form className="card id-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="field">{t('identity.name')}
        <input className="input" value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setError(undefined); setDone(false); }} />
        <span className="hint">{t('identity.nameHint')}</span>
      </label>

      <fieldset className="field">
        <legend>{t('identity.palette')}</legend>
        <div className="id-palettes" role="radiogroup" aria-label={t('identity.palette')}>
          {PALETTES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={palette?.id === p.id} className="id-palette"
              onClick={() => { setAccent(p.accent); setError(undefined); setDone(false); }}>
              <span className="id-dot" style={{ background: p.accent }} aria-hidden="true" />
              {t(`identity.palettes.${p.id}`)}
            </button>
          ))}
          <label className={`id-palette${palette ? '' : ' is-on'}`}>
            <input type="color" className="id-color" value={validAccent ? accent : DEFAULT_ACCENT}
              onChange={(e) => { setAccent(e.target.value); setError(undefined); setDone(false); }} />
            {t('identity.custom')}
          </label>
          <input className="input mono id-hex" aria-label={t('identity.accentHex')} value={accent} maxLength={7} spellCheck={false}
            aria-invalid={!validAccent} onChange={(e) => { setAccent(e.target.value.trim()); setError(undefined); setDone(false); }} />
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>{t('identity.font')}</legend>
        <div className="id-choices" role="radiogroup" aria-label={t('identity.font')}>
          {FONT_IDS.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={font === id} className="id-choice" onClick={() => { setFont(id); setDone(false); }}
              style={{ fontFamily: FONTS[id].display ?? FONTS[id].sans }}>
              <span className="id-aa" aria-hidden="true">Aa</span>
              <span>{t(`identity.fonts.${id}`)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>{t('identity.radius')}</legend>
        <div className="id-choices" role="radiogroup" aria-label={t('identity.radius')}>
          {RADIUS_IDS.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={radius === id} className="id-choice" onClick={() => { setRadius(id); setDone(false); }}>
              <span className={`id-corner corner-${id}`} aria-hidden="true" />
              <span>{t(`identity.radii.${id}`)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <span id="id-icon-l">{t('identity.icon')}</span>
        <div className="id-row">
          <Mark icon={shownIcon} size={48} />
          <label className="btn btn-sm btn-soft">
            {t('identity.iconChange')}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" aria-describedby="id-icon-l"
              onChange={(e) => void pick(e.target.files?.[0], iconPng, setIcon, 'identity.iconInvalid')} />
          </label>
          {shownIcon && <button type="button" className="link-btn" onClick={() => { setIcon(null); setDone(false); }}>{t('identity.iconReset')}</button>}
        </div>
        <span className="hint">{t('identity.iconHint')}</span>
      </div>

      <div className="field">
        <span id="id-bg-l">{t('identity.background')}</span>
        <div className="id-row">
          <div className="id-login" style={{ backgroundImage: shownBackground ? `url("${shownBackground}")` : drawnLogin(validAccent ? accent : brand.accent) }} aria-hidden="true">
            <span className="id-login-card"><Mark icon={shownIcon} size={14} /><b>{name.trim() || brand.defaults.name}</b></span>
          </div>
          <label className="btn btn-sm btn-soft">
            {t('identity.backgroundChange')}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-describedby="id-bg-l"
              onChange={(e) => void pick(e.target.files?.[0], backgroundJpeg, setBackground, 'identity.backgroundInvalid')} />
          </label>
          {shownBackground && <button type="button" className="link-btn" onClick={() => { setBackground(null); setDone(false); }}>{t('identity.backgroundReset')}</button>}
        </div>
        <span className="hint">{t('identity.backgroundHint')}</span>
      </div>

      <p className="hint">{t('identity.restartNote')}</p>
      {(error || action.phase === 'failed') && <p className="field-err" role="alert">{error ?? action.error}</p>}
      {done && !changed && <p className="id-saved" role="status">✓ {t('identity.saved')}</p>}

      <div className="id-foot">
        <button type="button" className="link-btn" disabled={busy} onClick={resetAll}>{t('identity.resetAll')}</button>
        <span className="grow" />
        <button type="submit" className="btn btn-pri" disabled={busy || !changed}>{busy ? t('identity.saving') : t('identity.save')}</button>
      </div>
    </form>
  );
}
