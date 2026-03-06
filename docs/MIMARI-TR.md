# PrivAgent: Proje Mimarisi ve Gizlilik Modeli

*Versiyon 4.4 — Mart 2026*

---

## 1. PrivAgent Nedir?

PrivAgent, **Base L2 zincirine gizlilik katmanı ekleyen bir ödeme protokolüdür.** AI agent'lar (otonom yazılım ajanları) x402 HTTP ödeme protokolü ile API'lara ödeme yapar. Problem: bu ödemelerin hepsi herkese açık, zincir üzerinde görünür.

Bir agent bir API'ya 1 USDC ödediğinde, herkes bunu görebilir:
- Kim ödedi?
- Kime ödedi?
- Ne kadar ödedi?
- Ne zaman, hangi API'ya, kaç kez?

Bu, agent'ların ticari stratejilerini, harcama kalıplarını ve iş ilişkilerini ifşa eder. **PrivAgent bu sorunu çözer.**

### Ne Yapıyor?

USDC'yi bir "korumalı havuz" (ShieldedPoolV4) kontratına kilitler. Bu havuzdaki bakiyeler **şifreli UTXO'lar** olarak tutulur. Her işlem bir **ZK (sıfır bilgi) kanıtı** ile yapılır. Zincir üzerinde sadece kriptografik kanıt görünür — miktar, gönderici ve alıcı gizlidir.

### Neden Yapıyoruz?

| Sebep | Açıklama |
|-------|----------|
| **Strateji sızıntısı** | Rakip agent'lar birbirlerinin API harcamalarını izleyebilir |
| **MEV saldırıları** | Yıllık $1B+ değerinde front-running kayıpları |
| **Rekabet istihbaratı** | Ödeme geçmişinden tüm iş modeli çıkarılabilir |
| **Pazar boşluğu** | Base'de x402+ERC-8004 uyumlu hiçbir gizlilik protokolü yok |

---

## 2. Temel Kavramlar

### UTXO Modeli

Geleneksel banka hesabı yerine **harcanmamış işlem çıktısı (UTXO)** modeli kullanılır. Bitcoin'e benzer ama gizli.

```
Hesap modeli:      Alice bakiyesi = 10 USDC (herkes görür)
UTXO modeli:       UTXO_1 = Poseidon(5, pubkey, r1) → commitment_1
                   UTXO_2 = Poseidon(5, pubkey, r2) → commitment_2
                   (kimse ne kadar olduğunu bilmez, commitment = hash)
```

Her UTXO şu 3 bileşenden oluşur:
- **amount**: Miktar (6 decimal USDC)
- **pubkey**: Alıcının Poseidon public key'i → `Poseidon(privateKey)`
- **blinding**: Rastgele alan elemanı (her UTXO'yu benzersiz yapar)

### Commitment (Taahhüt)

```
commitment = Poseidon(amount, pubkey, blinding)
```

Bu hash zincire yazılır. Kimse sadece hash'ten amount veya pubkey çıkaramaz. Ama sahibi bu 3 değeri bildiği için UTXO'nun kendisine ait olduğunu kanıtlayabilir.

### Nullifier (Geçersizleştirici)

Bir UTXO harcanırken, bunu kanıtlamak için nullifier üretilir:

```
nullifier = Poseidon(commitment, leafIndex, privateKey)
```

- Her UTXO sadece **bir kez** harcanabilir (nullifier zincire yazılır)
- Nullifier'dan commitment'e veya privateKey'e geri dönülemez (tek yönlü hash)
- İki farklı UTXO farklı nullifier üretir → **bağlantısız**

### Merkle Ağacı

Tüm commitment'lar derinlik 20'lik bir Merkle ağacına eklenir (~1 milyon yaprak kapasitesi). Bir UTXO'nun havuzda var olduğunu kanıtlamak için Merkle kanıtı kullanılır — hangi UTXO olduğu ortaya çıkmadan.

---

## 3. V3'ten V4'e Geçiş: Stealth Adresler → ECDH Note Encryption

### V3: Stealth Adresler (Eski Sistem)

V3'te alıcı gizliliği **stealth adresler** ile sağlanıyordu:

```
1. Sunucu 2 keypair yayınlar: spendingPubKey + viewingPubKey
2. Gönderici rastgele ephemeral key üretir
3. ECDH(ephemeralPriv, viewingPub) → sharedSecret
4. stealthPubKey = spendingPub + hash(sharedSecret) × G
5. stealthAddress = keccak256(stealthPubKey)
   → Paraları bu tek kullanımlık adrese gönderir
```

**V3'ün Problemleri:**
- Her ödeme için yeni bir Ethereum adresi gerekiyor
- **Miktarlar zincir üzerinde AÇIK** — withdraw() sinyallerinde görünüyor
- Tek-girdi circuit'i → bir seferde sadece 1 UTXO harcanabiliyor
- StealthRegistry ayrı bir kontrat, ekstra karmaşıklık
- Stealth adresi + UTXO modeli birbirine uymuyordu

### V4: ECDH Note Encryption (Yeni Sistem)

V4'te stealth adresleri tamamen kaldırdık. Yerine:

1. **Poseidon public key** = `Poseidon(privateKey)` → cüzdan kimliği
2. **secp256k1 ECDH** → şifreleme anahtarı türetme
3. **AES-256-GCM** → UTXO verilerini şifreleme
4. **JoinSplit circuit** → çoklu giriş/çıkış, miktarlar tamamen gizli

```
V3:  Stealth adres → Ethereum adresi hesaplama → miktarlar açık
V4:  ECDH key exchange → AES şifreleme → miktarlar GİZLİ
```

### Neden Değiştirdik?

| Konu | V3 (Stealth) | V4 (ECDH Note Encryption) |
|------|-------------|---------------------------|
| **Miktar gizliliği** | Zincirde AÇIK | Tamamen GİZLİ (publicAmount=0) |
| **Alıcı gizliliği** | Tek kullanımlık adres | Poseidon pubkey (hash içinde) |
| **UTXO modeli** | Tek girdi | JoinSplit (1x2, 2x2) — çoklu girdi/çıktı |
| **Anahtar yönetimi** | 2 keypair (spending+viewing) | 1 Poseidon key + 1 ECDH key |
| **Karmaşıklık** | Stealth Registry + ephemeral key | Tek encryptNote/decryptNote fonksiyonu |
| **View tag** | İlk byte (deterministik) | Poseidon(priv, pub, nonce) — rastgele |
| **Uyumluluk** | StealthRegistry ayrı kontrat | Tek ShieldedPoolV4 kontratı |

**Kısaca:** Stealth adresleri "alıcı kim?" sorusunu çözüyordu ama "ne kadar?" sorusunu çözmüyordu. V4'te her iki soruyu da çözüyoruz.

---

## 4. Gizlilik Nasıl Sağlanıyor?

### 4.1. ECDH Key Exchange (Diffie-Hellman Anahtar Değişimi)

İki taraf (alıcı ve gönderici) hiç ortak anahtar paylaşmadan aynı gizli anahtarı üretir:

```
Alıcı (Buyer):    ecdhPrivKey_A, ecdhPubKey_A
Sunucu (Server):  ecdhPrivKey_B, ecdhPubKey_B

sharedSecret = ECDH(privKey_A, pubKey_B)
             = ECDH(privKey_B, pubKey_A)   ← Aynı sonuç!

encryptionKey = HKDF-SHA256(sharedSecret, salt, info, 32 byte)
```

Bu key ile UTXO verileri AES-256-GCM ile şifrelenir.

### 4.2. Note Encryption (Not Şifreleme)

Bir ödeme yapılırken UTXO verileri şifrelenir:

```
Düz metin (72 byte):
  ├── amount   (8 byte, big-endian)    → 1,000,000 (1 USDC)
  ├── pubkey   (32 byte, big-endian)   → Poseidon(serverPrivKey)
  └── blinding (32 byte, big-endian)   → Rastgele alan elemanı

Şifreli çıktı (100 byte):
  ├── IV       (12 byte)              → Rastgele başlangıç vektörü
  ├── AuthTag  (16 byte)              → Bütünlük kanıtı (tamper detection)
  └── Ciphertext (72 byte)            → AES-256-GCM şifreli veri
```

**Sadece doğru ECDH private key'e sahip olan taraf şifreyi çözebilir:**
- Ödeme notu (enc1) → Sunucunun ECDH key'i ile şifrelenir → sadece sunucu çözebilir
- Para üstü notu (enc2) → Alıcının kendi ECDH key'i ile şifrelenir → sadece alıcı çözebilir

### 4.3. JoinSplit ZK Circuit (Sıfır Bilgi Kanıtı)

Her işlem bir Groth16 ZK kanıtı üretir. Bu kanıt şunları kanıtlar **ama ortaya çıkarmaz:**

```
Circuit şunu kanıtlar:
  1. "Bu UTXO'ların sahibiyim" (privateKey'i biliyorum)
  2. "Bu UTXO'lar Merkle ağacında var" (membership proof)
  3. "Girdiler + publicAmount = Çıktılar + protocolFee" (denge korunuyor)
  4. "Nullifier'lar doğru hesaplanmış" (çift harcama yok)
  5. "Miktarlar 0 ile 2^120 arasında" (taşma yok)

Circuit şunları GİZLER:
  ✗ Miktarlar (amount)
  ✗ Alıcı kimliği (pubkey)
  ✗ Gönderici kimliği (privateKey)
  ✗ Hangi UTXO harcanıyor (blinding)
  ✗ Girdi/çıktı bağlantısı (nullifier unlinkable)
```

### 4.4. Zincir Üzerinde Ne Görünür?

Bir private transfer yapıldığında zincirdeki veriler:

```solidity
transact() çağrısı:
  pA, pB, pC       → ZK kanıtı (anlamsız sayılar)
  root              → Merkle kökü (hangi ağaç durumu)
  publicAmount = 0  → "Hiç para giriş/çıkış yok" (GİZLİ transfer)
  extDataHash       → Rastgele görünen hash
  protocolFee       → Protokol ücreti (minimum $0.01)
  inputNullifiers   → Harcanan UTXO'ların nullifier'ları (bağlantısız)
  outputCommitments → Yeni UTXO commitment'ları (bağlantısız)
  viewTags          → 1 byte per çıktı (tarama optimizasyonu)
```

**Bir blockchain gözlemcisi:**
- "Birisi bir JoinSplit işlemi yaptı" → Doğru
- "Kim yaptı?" → **Bilinmiyor** (nullifier bağlantısız)
- "Kime gönderdi?" → **Bilinmiyor** (commitment gizli)
- "Ne kadar?" → **Bilinmiyor** (publicAmount=0, miktar şifreli)
- "Bu işlem şu önceki işlemle ilgili mi?" → **Bilinmiyor** (UTXO modeli bağlantıyı kırar)

### 4.5. View Tags (Tarama Optimizasyonu)

Alıcı, havuzdaki tüm UTXO'ları tarayarak kendisine ait olanları bulur. Ama 1 milyon UTXO varsa her birini ECDH + AES ile decrypt etmek çok yavaştır.

Çözüm: **View Tag** — her UTXO'ya 1 byte etiket eklenir:

```
viewTag = Poseidon(senderPrivKey, recipientPubKey, nonce) mod 256
```

Tarama:
1. Her UTXO'nun view tag'ını kontrol et (1 byte karşılaştırma)
2. Sadece eşleşenleri decrypt et (~1/256 oranı)
3. ~256x hızlanma

V4.4'te nonce eklendi — aynı sender→recipient çifti her seferinde farklı tag üretir, böylece "bu 2 UTXO aynı kişiye gitti" bilgisi sızamaz.

---

## 5. x402 Ödeme Akışı

### Tam Akış (Agent → API)

```
                                    ZİNCİR ÜZERİ
                                    ─────────────
1. Agent: GET /api/weather
   ← Sunucu: HTTP 402 + {price: "1000000", payToPubkey: "...",
                          serverEcdhPubKey: "...", scheme: "zk-exact-v2"}

2. Agent:
   a) Coin selection → uygun UTXO'ları seç
   b) paymentUTXO = createUTXO(1_000_000, serverPoseidonPubkey)
   c) changeUTXO = createUTXO(kalan, myPoseidonPubkey)
   d) enc1 = encryptNote(paymentUTXO, myEcdhPriv, serverEcdhPub)
   e) enc2 = encryptNote(changeUTXO, myEcdhPriv, myEcdhPub)
   f) JoinSplit ZK kanıtı üret (Groth16, ~10-30 saniye)
   g) Payment header = base64(JSON{proof, nullifiers, commitments, ...})

3. Agent: GET /api/weather + Payment: <base64 header>

4. Sunucu (Middleware):
   a) Rate limit kontrolü (IP bazlı)
   b) Payment header decode
   c) extDataHash doğrulama (front-running koruması)
   d) Relayer/fee doğrulama
   e) decryptNote(enc1, serverEcdhPriv, agentEcdhPub)
      → amount >= price mı? ✓
      → pubkey = serverPubkey mi? ✓
   f) Pre-flight: isKnownRoot() + nullifier kontrolü
   g) Off-chain snarkjs kanıt doğrulama
   h) On-chain: pool.transact() çağrısı                    ← Zincir işlemi
   i) TX onay bekle

5. Sunucu: HTTP 200 + {temp: 22, city: "Istanbul"}
   X-Payment-TxHash: 0xabc...

6. Agent: API yanıtını işle, UTXO durumunu güncelle
```

### Bu Akışta Gizlilik Nerede?

| Adım | Gizli mi? | Açıklama |
|------|-----------|----------|
| Agent → Sunucu HTTP | HTTPS ile gizli | TLS şifreli |
| Payment header | Base64, HTTPS | Sadece sunucu görür |
| enc1 (ödeme notu) | AES-256-GCM | Sadece sunucu decrypt edebilir |
| enc2 (para üstü) | AES-256-GCM | Sadece agent decrypt edebilir |
| pool.transact() | Zincirde AÇIK ama anlamsız | publicAmount=0, nullifier bağlantısız |
| Miktar | **TAM GİZLİ** | Ne zincirde ne başka yerde görünür |
| Gönderici | **TAM GİZLİ** | Nullifier → gönderici bağlantısı yok |
| Alıcı | **SUNUCU BİLİR** | Sunucu kendisi alıcı (by design) |
| 3. Parti | **HİÇBİR ŞEY** | Zincir gözlemcisi anlamsız sayılar görür |

---

## 6. Protokol Ücreti (Circuit-Level Fee)

Ücret ZK circuit seviyesinde zorunlu tutulur — atlanamaz:

```
Circuit denklemi:
  sum(girdiler) + publicAmount = sum(çıktılar) + protocolFee

Ücret hesabı:
  fee = max(amount × 0.001, 10000)  → max(%0.1, $0.01)
```

Bu, proof'un kendisinin bir parçasıdır. Yanlış ücret → geçersiz kanıt → zincir reddeder.

---

## 7. Güvenlik Katmanları

```
┌─────────────────────────────────────────────────────┐
│  Katman 7: View Tags (tarama gizliliği)            │
├─────────────────────────────────────────────────────┤
│  Katman 6: AES-256-GCM Note Encryption             │
│           (UTXO verileri şifreli)                   │
├─────────────────────────────────────────────────────┤
│  Katman 5: secp256k1 ECDH Key Exchange             │
│           (ortak anahtar türetme)                   │
├─────────────────────────────────────────────────────┤
│  Katman 4: Groth16 ZK Proof (JoinSplit)            │
│           (denge, sahiplik, üyelik kanıtı)          │
├─────────────────────────────────────────────────────┤
│  Katman 3: Poseidon Hash (commitment + nullifier)  │
│           (tek yönlü, collision-resistant)          │
├─────────────────────────────────────────────────────┤
│  Katman 2: Merkle Tree (depth 20)                  │
│           (UTXO üyelik kanıtı)                     │
├─────────────────────────────────────────────────────┤
│  Katman 1: UTXO Model (JoinSplit)                  │
│           (girdi/çıktı bağlantısız)                │
├─────────────────────────────────────────────────────┤
│  Katman 0: Base L2 (Ethereum güvenliği)            │
└─────────────────────────────────────────────────────┘
```

---

## 8. Kontratlar (Base Sepolia — Canlı)

| Kontrat | Adres | Rolü |
|---------|-------|------|
| ShieldedPoolV4 | `0x8F1ae8209156C22dFD972352A415880040fB0b0c` | Ana havuz kontratı |
| Groth16Verifier_1x2 | `0xC53c8E05661450919951f51E4da829a3AABD76A2` | 1-girdi-2-çıktı kanıt doğrulayıcı |
| Groth16Verifier_2x2 | `0xE77ad940291c97Ae4dC43a6b9Ffb43a3AdCd4769` | 2-girdi-2-çıktı kanıt doğrulayıcı |
| PoseidonHasher | `0x70Aa742C113218a12A6582f60155c2B299551A43` | Poseidon hash hesaplayıcı |

Deploy bloğu: `38347380`

---

## 9. Proje Yapısı

```
privagent/
├── contracts/              Solidity (Foundry) — 117 test
│   ├── src/ShieldedPoolV4.sol     Ana havuz kontratı
│   ├── src/PoseidonHasher.sol     Poseidon hash
│   └── test/                      Foundry testleri
├── circuits/               Circom — JoinSplit ZK devreleri
│   ├── src/joinSplit.circom       1x2 ve 2x2 JoinSplit
│   └── build/                     Derlenmiş devre + key'ler
├── sdk/                    TypeScript SDK — 109 test
│   ├── src/v4/                    UTXO engine, şifreleme, not deposu
│   │   ├── shieldedWallet.ts      Ana cüzdan API'si
│   │   ├── noteEncryption.ts      ECDH + AES-256-GCM
│   │   ├── utxo.ts                UTXO oluşturma, commitment, nullifier
│   │   ├── viewTag.ts             View tag hesaplama
│   │   ├── noteStore.ts           Şifreli not deposu (AES-256-GCM)
│   │   ├── coinSelection.ts       UTXO seçim algoritması
│   │   ├── joinSplitProver.ts     ZK kanıt üretici
│   │   └── treeSync.ts            Merkle ağaç senkronizasyonu
│   └── src/x402/                  x402 protokol katmanı
│       ├── zkExactSchemeV2.ts     İstemci: ZK ödeme oluşturma
│       ├── middlewareV2.ts        Sunucu: Express paywall middleware
│       ├── externalRelay.ts       Harici relayer iletişimi
│       ├── facilitatorServer.ts   x402 facilitator sunucu
│       └── relayerServer.ts       Relayer sunucu
├── packages/               Ek paketler
│   ├── openclaw-skill/            OpenClaw agent skill'i
│   └── virtuals-plugin/           Virtuals agent eklentisi
├── app/                    Demo web uygulaması (Next.js 14)
├── examples/               Entegrasyon örnekleri
├── scripts/                Deploy ve test scriptleri
└── docs/                   Protokol dokümantasyonu
```

---

## 10. Özet Tablo

| Soru | Cevap |
|------|-------|
| **Ne?** | Base L2 üzerinde AI agent'lar için gizli USDC ödeme protokolü |
| **Neden?** | Agent ödemeleri herkese açık → strateji sızıntısı, MEV, rekabet istihbaratı |
| **Nasıl?** | ZK-UTXO (Groth16 + Poseidon) + ECDH note encryption (AES-256-GCM) |
| **Stealth neden kaldırıldı?** | Miktarları gizleyemiyordu, UTXO modeline uymuyordu, gereksiz karmaşıklık |
| **ECDH ne sağlıyor?** | Ortak anahtar olmadan şifreleme key türetme → UTXO verilerini AES ile şifreleme |
| **Kim ne biliyor?** | Sunucu: ödeme miktarı (by design). Gözlemci: hiçbir şey. Agent: kendi bakiyesi |
| **Zincirde ne görünür?** | Anlamsız sayılar: proof, nullifier, commitment, viewTag |
| **Test sayısı** | 226 (117 Foundry + 109 SDK) |
| **Lisans** | BUSL-1.1 (2028'de GPL-2.0'a dönüşür) |

---

*Bu doküman PrivAgent V4.4 mimarisini açıklar. Teknik detaylar için bkz: [PROTOCOL.md](PROTOCOL.md), [CIRCUITS.md](CIRCUITS.md)*
