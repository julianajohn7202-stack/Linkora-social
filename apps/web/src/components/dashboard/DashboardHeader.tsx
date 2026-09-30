"use client";

import React, { useState } from "react";

interface DashboardHeaderProps {
  isLoading: boolean;
  onToggleLoading: () => void;
}

const subNavTabs = ["Cont rives", "F0A8200", "Mycontonts", "Deshlohns"];

export function DashboardHeader({ isLoading, onToggleLoading }: DashboardHeaderProps) {
  const [activeTab, setActiveTab] = useState("Cont rives");

  return (
    <header
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        padding: "24px 24px 16px 24px",
        borderBottom: "1px solid var(--border, #334155)",
        backgroundColor: "var(--bg-primary, #0B1120)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        {/* Title & Subtitle */}
        <div className="dashboard-header-title" style={{ minWidth: 0, flex: "1 1 200px" }}>
          <h1
            style={{
              margin: 0,
              color: "var(--text-primary, #F8FAFC)",
              fontSize: "1.75rem",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              wordBreak: "break-word",
            }}
          >
            Daskloode
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              color: "var(--text-secondary, #94A3B8)",
              fontSize: "0.9rem",
            }}
          >
            Explore community updates, Stellar Soroban posts, and custom content streams.
          </p>
        </div>

        {/* Skeleton Toggle Button & Create Action */}
        <div
          className="dashboard-header-actions"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={onToggleLoading}
            style={{
              padding: "8px 14px",
              borderRadius: "10px",
              border: "1px solid var(--border, #334155)",
              backgroundColor: "var(--bg-secondary, #1E293B)",
              color: "var(--text-secondary, #94A3B8)",
              fontSize: "0.85rem",
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {isLoading ? "Show Posts" : "Skeleton View"}
          </button>
          <button
            style={{
              padding: "8px 18px",
              borderRadius: "10px",
              border: "none",
              background: "linear-gradient(135deg, #60A5FA 0%, #818CF8 100%)",
              color: "#FFFFFF",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(96, 165, 250, 0.25)",
              whiteSpace: "nowrap",
            }}
          >
            + Create Post
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <nav
        style={{
          display: "flex",
          gap: "8px",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {subNavTabs.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "8px 16px",
                borderRadius: "20px",
                border: isActive
                  ? "1px solid var(--accent-primary, #60A5FA)"
                  : "1px solid transparent",
                backgroundColor: isActive ? "#1E293B" : "transparent",
                color: isActive
                  ? "var(--accent-primary, #60A5FA)"
                  : "var(--text-secondary, #94A3B8)",
                fontSize: "0.9rem",
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                transition: "all 0.2s ease",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {tab}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
