import { useEffect } from "react";

const defaultProducts = [
  {
    id: "tee-001",
    name: "TinyCart Tee",
    price: "24.00",
    options: { size: "M", color: "Black" }
  }
];

export function TinyCartProducts({ products = defaultProducts }) {
  useEffect(() => {
    if (!window.tinycart) return;

    window.tinycart.init({
      cartKey: "react-store",
      currency: "USD",
      apiCheckout: "/tinycart/checkout.php",
      apiCoupon: "/tinycart/coupon.php",
      catalogUrl: "/tinycart/catalog.php"
    });
  }, []);

  return (
    <div>
      {products.map((product) => (
        <button
          key={product.id}
          data-tc-id={product.id}
          data-tc-name={product.name}
          data-tc-price={product.price}
          data-tc-options={JSON.stringify(product.options ?? {})}
        >
          Add {product.name}
        </button>
      ))}
    </div>
  );
}
