//! urbivue-core — pure measurement logic shared by every Urbivue device.
//!
//! This crate is the *testable* half of the firmware: filtering, unit
//! conversion, RMS math, tilt geometry, counter state machines, and Modbus
//! frame handling. It is `no_std`, has zero dependencies, and every module
//! carries unit tests that run on the host (`cargo test`) — so the
//! measurement math is verified long before any hardware exists. The
//! device binaries (and the host emulator) are thin shells around it that
//! only read pins and move bytes.

#![cfg_attr(not(test), no_std)]

pub mod bins;
pub mod math;
pub mod median;
pub mod power;
pub mod pzem;
pub mod rain;
pub mod tilt;
pub mod traffic;
pub mod water;
