//! Minimal MQTT 3.1.1 client: CONNECT + QoS0 PUBLISH, which is exactly what
//! an Urbivue device needs. Zero dependencies by design — it also documents
//! how little protocol a sensor has to speak.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub struct MqttClient {
    stream: TcpStream,
}

fn encode_remaining_length(mut len: usize, out: &mut Vec<u8>) {
    loop {
        let mut byte = (len % 128) as u8;
        len /= 128;
        if len > 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if len == 0 {
            break;
        }
    }
}

fn push_utf8(buf: &mut Vec<u8>, s: &str) {
    buf.extend_from_slice(&(s.len() as u16).to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
}

impl MqttClient {
    pub fn connect(host: &str, port: u16, client_id: &str) -> std::io::Result<Self> {
        let stream = TcpStream::connect((host, port))?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;

        let mut var = Vec::new();
        push_utf8(&mut var, "MQTT");
        var.push(0x04); // protocol level 3.1.1
        var.push(0x02); // clean session
        var.extend_from_slice(&60u16.to_be_bytes()); // keepalive
        push_utf8(&mut var, client_id);

        let mut packet = vec![0x10];
        encode_remaining_length(var.len(), &mut packet);
        packet.extend_from_slice(&var);

        let mut client = Self { stream };
        client.stream.write_all(&packet)?;

        let mut connack = [0u8; 4];
        client.stream.read_exact(&mut connack)?;
        if connack[0] != 0x20 || connack[3] != 0x00 {
            return Err(std::io::Error::other(format!(
                "CONNACK refused: {connack:?}"
            )));
        }
        Ok(client)
    }

    pub fn publish(&mut self, topic: &str, payload: &[u8]) -> std::io::Result<()> {
        let mut var = Vec::new();
        push_utf8(&mut var, topic);
        var.extend_from_slice(payload);

        let mut packet = vec![0x30]; // PUBLISH, QoS0, no retain
        encode_remaining_length(var.len(), &mut packet);
        packet.extend_from_slice(&var);
        self.stream.write_all(&packet)
    }

    pub fn disconnect(mut self) {
        let _ = self.stream.write_all(&[0xE0, 0x00]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remaining_length_single_and_multi_byte() {
        let mut out = Vec::new();
        encode_remaining_length(127, &mut out);
        assert_eq!(out, vec![0x7F]);
        out.clear();
        encode_remaining_length(128, &mut out);
        assert_eq!(out, vec![0x80, 0x01]);
        out.clear();
        encode_remaining_length(321, &mut out);
        assert_eq!(out, vec![0xC1, 0x02]);
    }

    #[test]
    fn utf8_strings_are_length_prefixed() {
        let mut buf = Vec::new();
        push_utf8(&mut buf, "MQTT");
        assert_eq!(buf, vec![0x00, 0x04, b'M', b'Q', b'T', b'T']);
    }
}
