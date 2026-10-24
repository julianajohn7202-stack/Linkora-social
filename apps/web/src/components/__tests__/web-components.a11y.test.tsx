import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { NotificationItem, NotificationList } from "../NotificationList";
import { Proposal, ProposalCard } from "../ProposalCard";
import { SearchResults } from "../SearchResults";
import { VotePanel } from "../VotePanel";

const notification: NotificationItem = {
  id: "notification-1",
  kind: "follow",
  message: "Alex started following you.",
  timestamp: "2026-10-17T12:00:00.000Z",
  read: false,
};

const proposal: Proposal = {
  id: 7,
  title: "Routine protocol update",
  description: "Adjust a protocol parameter after community review.",
  proposer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  status: "active",
  votesFor: 3,
  votesAgainst: 2,
};

describe("web component accessibility", () => {
  it("has no serious accessibility violations in NotificationList", async () => {
    const { container } = render(<NotificationList notifications={[notification]} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("marks a notification read on keyboard activation", () => {
    const onMarkRead = jest.fn();
    render(<NotificationList notifications={[notification]} onMarkRead={onMarkRead} />);
    const row = screen.getByRole("button", { name: "New follower: Alex started following you." });

    row.focus();
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onMarkRead).toHaveBeenCalledWith("notification-1");
  });

  it("has no serious accessibility violations in VotePanel and keeps buttons keyboard reachable", async () => {
    const { container } = render(<VotePanel proposalId={7} />);
    const voteFor = screen.getByRole("button", { name: "Vote For" });
    voteFor.focus();
    expect(voteFor).toHaveFocus();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no serious accessibility violations in SearchResults", async () => {
    const { container } = render(<SearchResults tab="posts" query="stellar" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no serious accessibility violations in ProposalCard", async () => {
    const { container } = render(<ProposalCard proposal={proposal} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
