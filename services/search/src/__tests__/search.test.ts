import type { Pool } from "pg";
import { searchAll, searchPosts, searchProfiles } from "../search";

describe("search token routing", () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const pool = { query } as unknown as Pool;
  beforeEach(() => query.mockClear());

  it("routes hashtags to indexed post tags", async () => {
    await searchAll(pool, "#Stellar #Web3");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("p.tags @> $3::text[]"), [
      "",
      100,
      ["stellar", "web3"],
    ]);
  });

  it("routes mentions to profiles", async () => {
    await searchAll(pool, "@alice_42");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM profiles"), [
      "alice_42:*",
      100,
    ]);
  });

  it("routes mixed tokens to both paths with ordinary terms", async () => {
    await searchAll(pool, "hello #Stellar @alice");
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM profiles"), [
      "hello:* & alice:*",
      100,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM posts"), [
      "hello:*",
      100,
      ["stellar"],
    ]);
  });

  it("searches both paths for ordinary text", async () => {
    await searchAll(pool, "hello world");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("avoids database calls for empty queries and incompatible token types", async () => {
    await searchAll(pool, "; & !");
    await searchProfiles(pool, "#stellar");
    await searchPosts(pool, "@alice");
    expect(query).not.toHaveBeenCalled();
  });
});
