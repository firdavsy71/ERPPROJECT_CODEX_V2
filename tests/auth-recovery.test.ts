import {beforeEach,describe,it,expect,vi} from "vitest";
const mocks = vi.hoisted(()=>({actor:vi.fn(),execute:vi.fn(),save:vi.fn(),archive:vi.fn(),revalidate:vi.fn()}));
vi.mock("@/auth",()=>({currentActor:mocks.actor,signIn:vi.fn(),signOut:vi.fn()}));
vi.mock("@/services/operations",()=>({execute:mocks.execute}));
vi.mock("@/services/master",()=>({saveMaster:mocks.save,archiveMaster:mocks.archive}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("next-auth",()=>({AuthError:class AuthError extends Error {}}));
import {businessAction,masterAction,archiveAction} from "../src/app/actions";
beforeEach(()=>{vi.clearAllMocks();});
describe("server action authentication recovery",()=>{
  it("denies expired sessions before any write and logs no input or credentials",async()=>{
    mocks.actor.mockResolvedValue(null);
    const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try {
      const result=await businessAction("orderPurchase",{id:"private-customer-document",password:"secret"},"private-operation-key");
      expect(result).toMatchObject({ok:false,code:"SESSION_EXPIRED"});
      expect(result.requestId).toMatch(/^[a-f0-9-]{36}$/);
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
      const entry=JSON.parse(log.mock.calls[0][0]);
      expect(Object.keys(entry).sort()).toEqual(["action","category","event","requestId"]);
      expect(entry).toMatchObject({action:"orderPurchase",category:"session_unavailable"});
      expect(log.mock.calls.flat().join()).not.toMatch(/secret|private-customer|private-operation/);
    } finally {log.mockRestore();}
  });
  it("distinguishes auth infrastructure failure without exposing database errors",async()=>{
    mocks.actor.mockRejectedValue(new Error("postgresql://secret@example.invalid sensitive-query"));
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    try {
      const result=await businessAction("orderPurchase",{},"key");
      expect(result).toMatchObject({ok:false,code:"AUTH_UNAVAILABLE"});
      expect(result.message).not.toContain("postgresql");
      expect(log.mock.calls.flat().join()).not.toMatch(/postgresql|sensitive-query/);
      expect(mocks.execute).not.toHaveBeenCalled();
    } finally {log.mockRestore();}
  });
  it("allows the same request after login and preserves action idempotency key",async()=>{
    const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try {
      mocks.actor.mockResolvedValueOnce(null).mockResolvedValueOnce({id:"user",role:"inventory"});
      const input={id:"purchase"};
      expect((await businessAction("orderPurchase",input,"same-key")).ok).toBe(false);
      expect((await businessAction("orderPurchase",input,"same-key")).ok).toBe(true);
      expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({id:"user",role:"inventory"},"orderPurchase",input,"same-key");
    } finally {log.mockRestore();}
  });
  it("protects master and archive entrypoints identically",async()=>{
    mocks.actor.mockResolvedValue(null);
    const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try {
      expect((await masterAction("materials",{})).code).toBe("SESSION_EXPIRED");
      expect((await archiveAction("materials","id")).code).toBe("SESSION_EXPIRED");
      expect(mocks.save).not.toHaveBeenCalled();expect(mocks.archive).not.toHaveBeenCalled();
    } finally {log.mockRestore();}
  });
});
