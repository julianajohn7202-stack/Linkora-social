import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useFeed } from "./useFeed";
import { getCachedPosts, initDatabase } from "../utils/db";
import { fetchAndCachePosts } from "../utils/sync";

jest.mock("../utils/db", () => ({
  getCachedPosts: jest.fn(),
  initDatabase: jest.fn(),
  evictStaleCache: jest.fn(),
}));

jest.mock("../utils/sync", () => ({
  fetchAndCachePosts: jest.fn(),
}));

const mockedGetCachedPosts = jest.mocked(getCachedPosts);
const mockedInitDatabase = jest.mocked(initDatabase);
const mockedFetchAndCachePosts = jest.mocked(fetchAndCachePosts);

const post = (id: string) => ({
  id,
  author: "GABC",
  username: "user",
  content: `post ${id}`,
  tip_total: 0,
  timestamp: Number(id),
  like_count: 0,
  has_liked: false,
});

const page = (start: number) =>
  Array.from({ length: 10 }, (_, index) => post(String(start + index)));

describe("useFeed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedInitDatabase.mockResolvedValue(undefined);
    mockedGetCachedPosts.mockResolvedValue([post("1"), post("2")]);
  });

  it("retains the last successful cursor when loading the next page fails", async () => {
    mockedFetchAndCachePosts
      .mockResolvedValueOnce(page(1))
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(page(11));
    mockedGetCachedPosts
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce([...page(1), ...page(11)]);

    const { result } = renderHook(() => useFeed());

    await waitFor(() =>
      expect(mockedFetchAndCachePosts).toHaveBeenCalledWith(10, 0, expect.any(Function))
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(mockedFetchAndCachePosts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.loadMore();
    });
    expect(mockedFetchAndCachePosts).toHaveBeenNthCalledWith(2, 10, 10, expect.any(Function));
    expect(mockedFetchAndCachePosts).toHaveBeenNthCalledWith(3, 10, 10, expect.any(Function));
  });

  it("replaces an in-flight page with the latest first page and cursor", async () => {
    let completePage!: (posts: ReturnType<typeof page>) => void;
    mockedFetchAndCachePosts
      .mockResolvedValueOnce(page(1))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            completePage = resolve;
          })
      )
      .mockResolvedValueOnce(page(101))
      .mockResolvedValueOnce(page(111));
    mockedGetCachedPosts
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce(page(101))
      .mockResolvedValueOnce([...page(101), ...page(111)]);

    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());
    await waitFor(() => expect(mockedFetchAndCachePosts).toHaveBeenCalledTimes(2));
    act(() => result.current.refresh());
    expect(result.current.refreshing).toBe(true);
    const [, , isCurrent] = mockedFetchAndCachePosts.mock.calls[1];
    expect(isCurrent?.()).toBe(false);

    await act(async () => completePage(page(11)));
    await waitFor(() => expect(result.current.posts).toEqual(page(101)));
    expect(mockedFetchAndCachePosts).toHaveBeenNthCalledWith(3, 10, 0, expect.any(Function));

    await act(async () => result.current.loadMore());
    expect(mockedFetchAndCachePosts).toHaveBeenNthCalledWith(4, 10, 110, expect.any(Function));
  });
});
