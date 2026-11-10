const registry = new FinalizationRegistry((heldValue) => {
  console.log(`${heldValue} 已被回收`);
});

let obj = { data: "test" };
registry.register(obj, "my-object");

obj = { data: "123" };

if (typeof global.gc === "function") {
  global.gc();
}
