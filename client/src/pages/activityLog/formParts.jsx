import React, { useId } from 'react';

/* A labelled control: the label is tied to the input so it reads aloud and focuses it. */
export function Field({ label, required, className, children }) {
  const id = useId();
  const [control, ...extra] = React.Children.toArray(children);
  return (
    <div className={'af-field' + (className ? ` ${className}` : '')}>
      <label htmlFor={id}>{label}{required && <span className="af-req" aria-hidden="true"> *</span>}</label>
      {React.cloneElement(control, { id })}
      {extra}
    </div>
  );
}

/* Multi-select as toggle chips: every option is visible, no Ctrl-click needed. */
export function ChipGroup({ legend, required, options, selected, onToggle, disabled, scroll, status, statusIsError }) {
  return (
    <fieldset className="af-chipset" disabled={disabled}>
      <legend>{legend}{required && <span className="af-req" aria-hidden="true"> *</span>}</legend>
      <div className={'af-chips' + (scroll ? ' is-scroll' : '')}>
        {options.map(o => (
          <label key={o.id} className={'af-chip' + (selected.includes(o.id) ? ' is-on' : '')}>
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
            <span>{o.label}</span>
            {o.detail && <small>{o.detail}</small>}
            {o.note && <small className="af-chip-note">{o.note}</small>}
          </label>
        ))}
      </div>
      {status && <span className={statusIsError ? 'error-msg' : 'af-hint'} role={statusIsError ? 'alert' : 'status'}>{status}</span>}
    </fieldset>
  );
}
