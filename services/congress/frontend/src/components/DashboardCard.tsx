import { type CSSProperties } from "react";
import type { DashboardCard as Card, ResolvedDashboardBlock } from "@congress/shared-types";
import { ChatMarkdown, RecordTypeIcon, resolveChamberPath, sourceColorStyle, StackLink, useSourceColor } from "@congress/congress-ui";
import { useChatNavigation } from "@/chat/chatNav";
import { formatBlockTime } from "@/lib/formatBlockTime";

function Block({ block }: { block: ResolvedDashboardBlock }) {
  const nav = useChatNavigation();
  switch (block.type) {
    case "text":
      return <ChatMarkdown text={block.text} className="dash-text" {...nav} />;
    case "stat":
      return (
        <p className="dash-stat">
          <span className="dash-stat-value">{block.value}</span>
          <span className="dash-stat-label">{block.label}</span>
          {block.note && <span className="dash-stat-note">{block.note}</span>}
        </p>
      );
    case "facts":
      return (
        <dl className="dash-facts">
          {block.items.map((f, i) => (
            <div key={i} className="dash-fact">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={block.ordered ? "dash-list dash-list--ordered" : "dash-list"}>
          {block.items.map((item, i) => (
            <li key={i}>
              <ChatMarkdown text={item} className="dash-list-item" {...nav} />
            </li>
          ))}
        </Tag>
      );
    }
    case "time":
      return (
        <p className="dash-time">
          {block.label && <span className="dash-time-label">{block.label}</span>}
          {formatBlockTime(block)}
        </p>
      );
    case "record":
      if (!block.record) return null;
      return (
        <div className="dash-record">
          <StackLink to={resolveChamberPath(block.record.url, block.record.chamber)} className="dash-record-link">
            <RecordTypeIcon type={block.record.type} />
            <span className="dash-record-name">{block.record.name}</span>
          </StackLink>
          {block.note && <span className="dash-record-note">{block.note}</span>}
        </div>
      );
  }
}

// One dashboard card: the AI's own layout - a kicker, a title, then its blocks.
export function DashboardCard({ card }: { card: Card }) {
  const fallback = useSourceColor("dashboard");
  const style = sourceColorStyle(card.color ?? fallback) as CSSProperties;
  return (
    <section className="feed-card dash-card" style={style}>
      <div className="dash-card-body">
        {card.kicker && <span className="feed-kicker-label">{card.kicker}</span>}
        <h2 className="feed-record-name">{card.title}</h2>
        {card.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </section>
  );
}
