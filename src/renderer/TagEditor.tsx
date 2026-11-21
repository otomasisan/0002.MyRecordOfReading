import { useState } from 'react';

/** Toggle existing tags or type a new one and press Enter. */
export function TagEditor(props: { value: string[]; allTags: string[]; onChange: (tags: string[]) => void }) {
  const { value, allTags, onChange } = props;
  const [text, setText] = useState('');
  const options = [...new Set([...allTags, ...value])];

  const add = () => {
    const t = text.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setText('');
  };

  return (
    <div className="seg tags">
      {options.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={value.includes(t)}
          onClick={() => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])}
        >
          {t}
        </button>
      ))}
      <input
        aria-label="新しいタグ"
        placeholder="＋ 新しいタグ"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
