import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listLanIpv4Candidates,
  pickDefaultLanIpv4,
  type NetIfaceMap,
} from "./lanAddresses.js";

describe("lanAddresses", () => {
  const sample: NetIfaceMap = {
    "Ethernet": [
      {
        address: "192.168.1.42",
        family: "IPv4",
        internal: false,
      },
    ],
    "Loopback": [
      {
        address: "127.0.0.1",
        family: "IPv4",
        internal: true,
      },
    ],
    "vEthernet (WSL)": [
      {
        address: "172.22.80.1",
        family: "IPv4",
        internal: false,
      },
    ],
    "Wi-Fi": [
      {
        address: "10.0.0.8",
        family: "IPv4",
        internal: false,
      },
    ],
  };

  it("lists non-loopback IPv4 and excludes common virtual adapter names when others exist", () => {
    const candidates = listLanIpv4Candidates(sample);
    assert.deepEqual(
      candidates.map((c) => c.address),
      ["192.168.1.42", "10.0.0.8"],
    );
  });

  it("prefers 192.168/16 then 10/8 then 172.16/12 for default", () => {
    assert.equal(pickDefaultLanIpv4(listLanIpv4Candidates(sample)), "192.168.1.42");
  });

  it("returns no candidates rather than 127.0.0.1 when only loopback exists", () => {
    const onlyLoop: NetIfaceMap = {
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    };
    assert.deepEqual(listLanIpv4Candidates(onlyLoop), []);
    assert.equal(pickDefaultLanIpv4([]), null);
  });
});
