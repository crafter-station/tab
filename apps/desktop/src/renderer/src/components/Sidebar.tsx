type SidebarItem = {
  id: string;
  label: string;
};

type SidebarProps = {
  title: string;
  subtitle?: string;
  items: SidebarItem[];
  activeId: string;
};

export function Sidebar({ title, subtitle, items, activeId }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__mark">T</div>
        <div>
          <strong>{title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>
      <nav className="sidebar__nav" aria-label="Settings sections">
        {items.map((item) => (
          <span className="sidebar__item" data-active={item.id === activeId} key={item.id}>
            {item.label}
          </span>
        ))}
      </nav>
    </aside>
  );
}
