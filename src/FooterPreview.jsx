// Footer HTML is produced by the server allowlist, never directly from an editor.
export default function FooterPreview({ footer }) {
  if (!footer?.text && !footer?.html) return null;
  return footer.html
    ? <div className="signature-preview html-signature" aria-label="Email footer preview" dangerouslySetInnerHTML={{ __html: footer.html }} />
    : <div className="signature-preview" aria-label="Email footer preview">{footer.text}</div>;
}
