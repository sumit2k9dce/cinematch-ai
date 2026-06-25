import { useState } from "react";
import { UPI_ID, UPI_NAME } from "./config";

export default function ChaiButton() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(49);

  const upiLink = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(
    UPI_NAME
  )}&am=${amount}&cu=INR&tn=${encodeURIComponent("Chai for CineMatch")}`;

  return (
    <>
      <div className="chai">
        <button onClick={() => setOpen(true)}>
          ☕ <span className="label">Buy me a chai</span>
        </button>
      </div>

      {open && (
        <div className="modal-back" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Buy me a chai ☕</h3>
            <p>
              CineMatch is free and ad-free. If it helped you find something good,
              a small chai keeps it running.
            </p>

            <div className="amount-row">
              {[29, 49, 99].map((a) => (
                <button
                  key={a}
                  className={`amount ${amount === a ? "sel" : ""}`}
                  onClick={() => setAmount(a)}
                >
                  ₹{a}
                </button>
              ))}
            </div>

            <a className="btn primary" href={upiLink} style={{ width: "100%", justifyContent: "center" }}>
              Pay ₹{amount} via UPI
            </a>

            <div style={{ marginTop: 12, fontSize: 12, color: "var(--slate-dim)" }}>
              Opens any UPI app (GPay, PhonePe, Paytm). Or send to<br />
              <strong style={{ color: "var(--slate)" }}>{UPI_ID}</strong>
            </div>

            <button className="close" onClick={() => setOpen(false)}>Maybe later</button>
          </div>
        </div>
      )}
    </>
  );
}
