import React from "react";
import { Check } from "lucide-react";
import type { ActionItem } from "./CommandPalette";

interface PaletteSubViewsProps {
  view: "sub_appearance" | "sub_accents" | "sub_fonts" | "sub_zoom";
  filteredAppearance: ActionItem[];
  filteredAccents: ActionItem[];
  filteredFonts: ActionItem[];
  filteredZoom: ActionItem[];
  selectedIndex: number;
  handleItemMouseMove: (index: number, e: React.MouseEvent) => void;
}

export default function PaletteSubViews({
  view,
  filteredAppearance,
  filteredAccents,
  filteredFonts,
  filteredZoom,
  selectedIndex,
  handleItemMouseMove,
}: PaletteSubViewsProps) {
  let title = "";
  let items: ActionItem[] = [];

  if (view === "sub_appearance") {
    title = "Select Appearance Mode";
    items = filteredAppearance;
  } else if (view === "sub_accents") {
    title = "Select Accent Theme";
    items = filteredAccents;
  } else if (view === "sub_fonts") {
    title = "Select Editor Font";
    items = filteredFonts;
  } else if (view === "sub_zoom") {
    title = "Select Zoom Level";
    items = filteredZoom;
  }

  return (
    <div>
      <div className="command-category-header">{title}</div>
      {items.map((item, idx) => (
        <button
          key={item.id}
          className={`command-item ${idx === selectedIndex ? "is-selected" : ""}`}
          onClick={() => item.action()}
          onMouseMove={(e) => handleItemMouseMove(idx, e)}
        >
          <div className="command-item-icon">{item.icon}</div>
          <div className="command-item-text flex items-center min-w-0 flex-1">
            <span className="command-item-label truncate">{item.label}</span>
          </div>
          {item.badge && <Check size={14} className="text-emerald-400 ml-auto flex-shrink-0" />}
        </button>
      ))}
    </div>
  );
}
