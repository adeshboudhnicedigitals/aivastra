'use client';
import { Mail, MapPinned, Phone } from 'lucide-react';
import { useState } from 'react';
import { FaFacebookF, FaInstagram, FaLinkedin, FaYoutube } from 'react-icons/fa';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';

export default function ContactUsPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar title="Contact Us" subtitle="" />
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          background: C.bg,
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: 1156,
            height: 562,
            left: '48%',
            top: '48%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 80,
          }}
        >
          {/* Left - Contact Info */}
          <div
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'flex-start',
              padding: '20px 40px',
              gap: 32,
              width: 651,
              height: 562,
              background: '#FEFEFE',
              border: '1px solid #EEEEEE',
              boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.08)',
              borderRadius: 24,
              flex: 'none',
              order: 0,
              alignSelf: 'stretch',
              flexGrow: 0,
            }}
          >
            <div>
              <div style={{ fontSize: 26, fontWeight: 600, color: '#1A1A2E' }}>Lets Connect</div>
              <div style={{ fontSize: 14, color: C.mid, lineHeight: 1.5 }}>
                Reach out to us through any of the following channels.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
              {/* Email */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div
                  style={{
                    width: 45,
                    height: 45,
                    minWidth: 45,
                    borderRadius: 10,
                    border: '1px solid #DDDDDD',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Mail size={20} color={C.mid} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 4 }}>
                    Email
                  </div>
                  <div style={{ fontSize: 14, color: C.mid }}>support@aivastra.com</div>
                </div>
              </div>

              {/* Phone */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div
                  style={{
                    width: 45,
                    height: 45,
                    minWidth: 45,
                    borderRadius: 10,
                    border: '1px solid #DDDDDD',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Phone size={20} color={C.mid} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 4 }}>
                    Phone
                  </div>
                  <div style={{ fontSize: 14, color: C.mid }}>+91 7729883692</div>
                </div>
              </div>

              {/* Corporate Office */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div
                  style={{
                    width: 45,
                    height: 45,
                    minWidth: 45,
                    borderRadius: 10,
                    border: '1px solid #DDDDDD',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MapPinned size={20} color={C.mid} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 4 }}>
                    Corporate Office
                  </div>
                  <div style={{ fontSize: 14, color: C.mid, lineHeight: 1.5 }}>
                    #904, 9th Floor Asian Sun City Commercial Beside Sarath City Capital Mall
                    Kondapur, Hyderabad, 500084.
                  </div>
                </div>
              </div>

              {/* Head Office */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div
                  style={{
                    width: 45,
                    height: 45,
                    minWidth: 45,
                    borderRadius: 10,
                    border: '1px solid #DDDDDD',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MapPinned size={20} color={C.mid} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 4 }}>
                    Head Office
                  </div>
                  <div style={{ fontSize: 14, color: C.mid, lineHeight: 1.5 }}>
                    3rd Floor, Salumuri Vari St, above Ishita Mini Function Hall, Innespeta,
                    Rajamahendravaram, Andhra Pradesh, 533101.
                  </div>
                </div>
              </div>
            </div>

            {/* Follow Us */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 12 }}>
                Follow Us On
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  aria-label="Aivastra on Facebook"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#1877F2',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <FaFacebookF size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Aivastra on Instagram"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#E4405F',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <FaInstagram size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Aivastra on YouTube"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#FF0000',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <FaYoutube size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Aivastra on LinkedIn"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#0A66C2',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <FaLinkedin size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Right - Contact Form */}
          <div
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              padding: 20,
              gap: 24,
              width: 480,
              height: 562,
              background: '#FEFEFE',
              border: '1px solid #EEEEEE',
              boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.08)',
              borderRadius: 24,
              flex: 'none',
              order: 1,
              flexGrow: 0,
            }}
          >
            <div>
              <div style={{ fontSize: 26, fontWeight: 600, color: '#1A1A2E' }}>
                Send Us a Message
              </div>
              <div style={{ fontSize: 14, color: C.mid, lineHeight: 1.5 }}>
                Share few details, and we&apos;ll contact you soon.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
              {/* Full Name */}
              <div>
                <label
                  htmlFor="contact-name"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#1A1A2E',
                    marginBottom: 6,
                    display: 'block',
                  }}
                >
                  Full Name<span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  id="contact-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Matt Borris"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    height: 42,
                    border: '1px solid #EEEEEE',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontSize: 13,
                    color: C.text,
                    background: '#FEFEFE',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Email */}
              <div>
                <label
                  htmlFor="contact-email"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#1A1A2E',
                    marginBottom: 6,
                    display: 'block',
                  }}
                >
                  Email<span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  id="contact-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mattborris@email.com"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    height: 42,
                    border: '1px solid #EEEEEE',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontSize: 13,
                    color: C.text,
                    background: '#FEFEFE',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Phone */}
              <div>
                <label
                  htmlFor="contact-phone"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#1A1A2E',
                    marginBottom: 6,
                    display: 'block',
                  }}
                >
                  Phone Number<span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  id="contact-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="9874563210"
                  inputMode="numeric"
                  maxLength={10}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    height: 42,
                    border: '1px solid #EEEEEE',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontSize: 13,
                    color: C.text,
                    background: '#FEFEFE',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Message */}
              <div>
                <label
                  htmlFor="contact-message"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#1A1A2E',
                    marginBottom: 6,
                    display: 'block',
                  }}
                >
                  Your Message
                </label>
                <textarea
                  id="contact-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us about your requirements, business, or any questions you have..."
                  rows={3}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: '1px solid #EEEEEE',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 13,
                    color: C.text,
                    background: '#FEFEFE',
                    resize: 'vertical',
                    outline: 'none',
                    fontFamily: 'inherit',
                    lineHeight: 1.5,
                  }}
                />
              </div>
            </div>

            {/* Submit */}
            <button
              type="button"
              style={{
                width: '100%',
                height: 44,
                background: grad,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Submit Message
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
