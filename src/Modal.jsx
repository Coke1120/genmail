import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, description, onClose, children, className = '', closeDisabled = false }) {
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => { previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className={`modal ${className}`} aria-labelledby="modal-title" onCancel={event => { event.preventDefault(); if (!closeDisabled) close.current(); }} onClick={event => { if (event.target === dialog.current && !closeDisabled) close.current(); }}>
    <div className="modal-header"><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={closeDisabled}><X size={20} /></button></div>
    {children}
  </dialog>;
}
