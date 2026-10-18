import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EpisodeAnswers } from "@/components/EpisodeAnswers";
import { TopicAnswers } from "@/components/TopicAnswers";

const mocks = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), from: vi.fn(), log: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: mocks.from,
  rpc: mocks.rpc,
} }));
vi.mock("@/lib/playerEvents", () => ({ logPlayerEvent: mocks.log }));
const answer = { id: "a", anchor: "answer-a", question: "Első kérdés?", answer: "Első válasz.", speaker: null,
  start_sec: 42, timestamp_status: "audio_verified", content_version: "v1", pilot_group: "treatment" };
const topicAnswer = { ...answer, answer_id: "a", episode_title: "Epizód", episode_slug: "epizod", podcast_title: "Podcast", podcast_slug: "podcast" };
const clients: QueryClient[] = [];
function Location() { const location = useLocation(); return <output data-testid="location">{location.search}{location.hash}</output>; }
function wrapper(path = "/podcast/podcast/epizod") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{children}<Location /></MemoryRouter></QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation(() => ({ select: () => ({ eq: (_: string, id: string) => ({ order: () => mocks.read(id) }) }) }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; });

describe("public answer navigation", () => {
  it("never shows the previous episode's answers while the next episode loads, and reuses cached answers", async () => {
    let resolveNext!: (value: unknown) => void;
    mocks.read.mockImplementation((id) => id === "first" ? Promise.resolve({ data: [answer] }) : new Promise((resolve) => { resolveNext = resolve; }));
    const view = render(<EpisodeAnswers episodeId="first" />, { wrapper: wrapper() });
    await screen.findByText(answer.question);
    view.rerender(<EpisodeAnswers episodeId="second" />);
    expect(screen.queryByText(answer.question)).not.toBeInTheDocument();
    await act(async () => resolveNext({ data: [] }));
    expect(screen.queryByText(answer.question)).not.toBeInTheDocument();
    view.rerender(<EpisodeAnswers episodeId="first" />);
    expect(screen.getByText(answer.question)).toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.from).toHaveBeenCalledWith("episode_answers_public");
  });

  it("isolates topic answers when navigating and reuses the original topic cache", async () => {
    mocks.rpc.mockImplementation((_, args) => Promise.resolve({ data: args._topic_id === "first" ? [topicAnswer] : [] }));
    const view = render(<TopicAnswers topicId="first" />, { wrapper: wrapper() });
    expect(await screen.findByRole("link")).toHaveAttribute("href", "/podcast/podcast/epizod#answer-a");
    view.rerender(<TopicAnswers topicId="second" />);
    expect(screen.queryByText(answer.question)).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    view.rerender(<TopicAnswers topicId="first" />);
    expect(screen.getByText(answer.question)).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("scrolls to a linked answer after it loads", async () => {
    mocks.read.mockResolvedValue({ data: [answer] });
    render(<EpisodeAnswers episodeId="first" />, { wrapper: wrapper("/podcast/podcast/epizod#answer-a") });
    await screen.findByText(answer.question);
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1));
  });

  it("preserves acquisition parameters and anchor when seeking to a verified answer", async () => {
    mocks.read.mockResolvedValue({ data: [answer] });
    render(<EpisodeAnswers episodeId="first" />, { wrapper: wrapper("/podcast/podcast/epizod?utm_source=chatgpt.com#answer-a") });
    fireEvent.click(await screen.findByRole("button", { name: /Hallgasd meg/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("?utm_source=chatgpt.com&t=42&qa=answer-a#answer-a");
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ episodeId: "first", positionSec: 42 }));
  });

  it.each([-1, NaN, Infinity, null])("does not offer seeking for an invalid timestamp (%s)", async (start_sec) => {
    mocks.read.mockResolvedValue({ data: [{ ...answer, start_sec }] });
    render(<EpisodeAnswers episodeId="first" />, { wrapper: wrapper() });
    await screen.findByText(answer.question);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not offer seeking for unverified transcript timing", async () => {
    mocks.read.mockResolvedValue({ data: [{ ...answer, timestamp_status: "transcript_only" }] });
    render(<EpisodeAnswers episodeId="first" />, { wrapper: wrapper() });
    await screen.findByText(answer.question);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
