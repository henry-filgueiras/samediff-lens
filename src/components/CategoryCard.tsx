import type { ReactNode } from "react";

type CategoryCardProps = {
  title: string;
  hasItems: boolean;
  emptyLabel?: string;
  children: ReactNode;
};

export function CategoryCard({
  title,
  hasItems,
  emptyLabel = "None detected.",
  children,
}: CategoryCardProps) {
  return (
    <section className="category-card">
      <div className="category-card-header">
        <h3>{title}</h3>
      </div>
      {hasItems ? <div>{children}</div> : <p className="empty-state">{emptyLabel}</p>}
    </section>
  );
}
