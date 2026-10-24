import { render, screen } from "@testing-library/react";
import { Proposal, ProposalCard } from "./ProposalCard";

const proposalFor = (status: Proposal["status"]): Proposal => ({
  id: 7,
  title: "Routine protocol update",
  description: "Adjust a protocol parameter after community review.",
  proposer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  status,
  votesFor: 3,
  votesAgainst: 2,
});

function snapshotCard(status: Proposal["status"]) {
  const { container } = render(<ProposalCard proposal={proposalFor(status)} />);
  return {
    actions: screen.queryAllByRole("button").map((button) => button.textContent?.trim()),
    badgeClass: screen.getByText(status).className,
    progress: screen.getByRole("progressbar").getAttribute("aria-valuenow"),
    title: container.querySelector("h3")?.textContent,
  };
}

describe("ProposalCard status snapshots", () => {
  it("snapshots the active status variant", () => {
    expect(snapshotCard("active")).toMatchInlineSnapshot(`
      {
        "actions": [
          "Vote For",
          "Vote Against",
        ],
        "badgeClass": "shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize bg-[var(--color-success-light)] text-[var(--color-success)] border border-[var(--color-success)]/30",
        "progress": "60",
        "title": "Routine protocol update",
      }
    `);
  });

  it("snapshots the passed status variant", () => {
    expect(snapshotCard("passed")).toMatchInlineSnapshot(`
      {
        "actions": [],
        "badgeClass": "shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize bg-[var(--color-info-light)] text-[var(--color-info)] border border-[var(--color-info)]/30",
        "progress": "60",
        "title": "Routine protocol update",
      }
    `);
  });

  it("snapshots the rejected status variant", () => {
    expect(snapshotCard("rejected")).toMatchInlineSnapshot(`
      {
        "actions": [],
        "badgeClass": "shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize bg-[var(--color-error-light)] text-[var(--color-error)] border border-[var(--color-error)]/30",
        "progress": "60",
        "title": "Routine protocol update",
      }
    `);
  });

  it("snapshots the pending status variant", () => {
    expect(snapshotCard("pending")).toMatchInlineSnapshot(`
      {
        "actions": [],
        "badgeClass": "shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize bg-[var(--color-warning-light)] text-[var(--color-warning)] border border-[var(--color-warning)]/30",
        "progress": "60",
        "title": "Routine protocol update",
      }
    `);
  });
});
